import type { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { exigeToken, exigePerfil, usuarioDe } from '../auth.js';
import { registrarAuditoria } from '../audit.js';
import { dadosTreinamento, podeVerTreinamento } from './read.js';
import { gerarTokenLink, hashToken } from '../tokens.js';
import { emailEmUso, localizarPorEmail, mapUsuario, normalizarEmail, resolverDepartamento, SELECT_USUARIO } from '../usuarios.js';
import { enviar, erro, wrap, vazio, emailFormatoValido, validarSenha, PERFIS, STATUS_USUARIO } from '../util.js';

// -----------------------------------------------------------------------------
// Rotas de ESCRITA adicionais ao contrato da N2 AT1: conta do usuario (senha,
// redefinicao, notificacoes), conclusao de treinamento e gestao de usuarios.
// Nenhuma delas altera as rotas testadas pela collection do Postman (api.ts).
// `exigeToken` ja carrega o usuario do banco (existencia + status) em req.usuarioAtual.
// -----------------------------------------------------------------------------

type ErroHttp = { status: number; mensagem: string; codigo: string };
function falha(status: number, mensagem: string, codigo: string): { falha: ErroHttp } {
  return { falha: { status, mensagem, codigo } };
}

// ---- Redefinicao de senha -----------------------------------------------------
// Nao ha servico de e-mail neste projeto (MailHog/SendGrid ficam para a infra de
// producao). O unico canal de entrega em dev/demo e o log do servidor, e ele e
// OPT-IN (RESET_TOKEN_CONSOLE=1) e nunca funciona em producao. No banco fica so o
// hash SHA-256 do token, com validade de 30 minutos e uso unico.

const RESET_VALIDADE_MS = 30 * 60 * 1000;
const RESET_JANELA_MS = 15 * 60 * 1000;
const RESET_MAX_POR_JANELA = 3;
const MSG_RESET_GENERICA =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.';

const tentativasReset = new Map<string, number[]>();

function excedeuLimiteReset(chave: string): boolean {
  const agora = Date.now();
  const recentes = (tentativasReset.get(chave) ?? []).filter((t) => agora - t < RESET_JANELA_MS);
  if (recentes.length >= RESET_MAX_POR_JANELA) {
    tentativasReset.set(chave, recentes);
    return true;
  }
  recentes.push(agora);
  tentativasReset.set(chave, recentes);
  // Poda periodica: o mapa nunca cresce sem limite (endpoint publico).
  if (tentativasReset.size > 1000) {
    for (const [k, v] of tentativasReset) {
      const vivos = v.filter((t) => agora - t < RESET_JANELA_MS);
      if (vivos.length) tentativasReset.set(k, vivos);
      else tentativasReset.delete(k);
    }
  }
  return false;
}

/** Zera o limitador de solicitacoes de redefinicao (usado pelos testes). */
export function limparLimiteReset(): void {
  tentativasReset.clear();
}

// ---- Preferencias de notificacao --------------------------------------------

const PREF_CAMPOS = ['alertasEmail', 'somenteCriticas', 'resumoSemanal', 'relatoriosCampanha'] as const;
type PrefCampo = (typeof PREF_CAMPOS)[number];

function mapPreferencias(p: Record<PrefCampo, boolean> & { atualizadoEm: Date }) {
  return {
    alertasEmail: p.alertasEmail,
    somenteCriticas: p.somenteCriticas,
    resumoSemanal: p.resumoSemanal,
    relatoriosCampanha: p.relatoriosCampanha,
    atualizadoEm: p.atualizadoEm,
  };
}

export function registerManageRoutes(r: Router) {
  // ---- POST /auth/change-password (protegido) --------------------------------
  r.post('/auth/change-password', exigeToken, wrap(async (req, res) => {
    const { senhaAtual, novaSenha } = req.body ?? {};
    if (vazio(senhaAtual)) return erro(res, 400, 'Senha atual é obrigatória', 'SENHA_ATUAL_OBRIGATORIA');
    if (vazio(novaSenha)) return erro(res, 400, 'Nova senha é obrigatória', 'NOVA_SENHA_OBRIGATORIA');
    const problema = validarSenha(novaSenha);
    if (problema) return erro(res, 400, problema, 'SENHA_FRACA');

    const usuario = usuarioDe(req);
    const confere = await bcrypt.compare(String(senhaAtual), usuario.senhaHash);
    if (!confere) return erro(res, 400, 'A senha atual está incorreta', 'SENHA_ATUAL_INCORRETA');
    if (String(senhaAtual) === String(novaSenha))
      return erro(res, 400, 'A nova senha deve ser diferente da atual', 'SENHA_REPETIDA');

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: usuario.id },
        // Conta criada pelo administrador (senha provisoria) passa a Ativo ao definir a propria senha.
        data: { senhaHash, status: usuario.status === 'Pendente' ? 'Ativo' : usuario.status },
      }),
      // Links de redefinicao ainda pendentes deixam de valer.
      prisma.passwordResetToken.deleteMany({ where: { userId: usuario.id } }),
    ]);
    await registrarAuditoria(usuario.id, 'ALTERAR_SENHA');
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Senha alterada com sucesso' });
  }));

  // ---- POST /auth/reset-password (publico) -----------------------------------
  r.post('/auth/reset-password', wrap(async (req, res) => {
    const { email } = req.body ?? {};
    if (!emailFormatoValido(email)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
    const chave = normalizarEmail(email);
    if (excedeuLimiteReset(chave))
      return erro(res, 429, 'Muitas solicitações. Aguarde alguns minutos.', 'MUITAS_TENTATIVAS');

    const usuario = await localizarPorEmail(String(email));
    if (usuario && usuario.status !== 'Inativo') {
      const token = gerarTokenLink();
      await prisma.passwordResetToken.create({
        data: { userId: usuario.id, tokenHash: hashToken(token), expiraEm: new Date(Date.now() + RESET_VALIDADE_MS) },
      });
      await registrarAuditoria(usuario.id, 'SOLICITAR_RESET_SENHA');
      // Em producao nunca imprime; fora dela, so com RESET_TOKEN_CONSOLE=1.
      if (process.env.NODE_ENV !== 'production' && process.env.RESET_TOKEN_CONSOLE === '1') {
        const base = process.env.FRONTEND_URL ?? 'http://localhost:5173';
        console.log(
          `[reset-senha] link para ${usuario.email} (válido por 30 min): ${base}/reset-password?token=${token}`,
        );
      }
    }
    // Resposta identica para e-mails conhecidos e desconhecidos (evita enumeracao de usuarios).
    return enviar(res, 200, { status: 'sucesso', mensagem: MSG_RESET_GENERICA });
  }));

  // ---- POST /auth/reset-password/confirm (publico) ---------------------------
  r.post('/auth/reset-password/confirm', wrap(async (req, res) => {
    const { token, novaSenha } = req.body ?? {};
    if (vazio(token)) return erro(res, 400, 'Token é obrigatório', 'TOKEN_OBRIGATORIO');
    if (vazio(novaSenha)) return erro(res, 400, 'Nova senha é obrigatória', 'NOVA_SENHA_OBRIGATORIA');
    const problema = validarSenha(novaSenha);
    if (problema) return erro(res, 400, problema, 'SENHA_FRACA');

    const registro = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(String(token).trim()) },
      include: { user: true },
    });
    if (!registro || registro.usadoEm || registro.expiraEm.getTime() < Date.now())
      return erro(res, 400, 'Token inválido ou expirado', 'TOKEN_RESET_INVALIDO');
    if (registro.user.status === 'Inativo')
      return erro(res, 400, 'Token inválido ou expirado', 'TOKEN_RESET_INVALIDO');

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: registro.userId },
        data: {
          senhaHash,
          status: registro.user.status === 'Pendente' ? 'Ativo' : registro.user.status,
          // Sessoes abertas antes da redefinicao deixam de valer (ver exigeToken).
          senhaAlteradaEm: new Date(),
        },
      }),
      prisma.passwordResetToken.update({ where: { id: registro.id }, data: { usadoEm: new Date() } }),
      // Demais tokens pendentes do mesmo usuario perdem a validade.
      prisma.passwordResetToken.deleteMany({ where: { userId: registro.userId, id: { not: registro.id } } }),
    ]);
    await registrarAuditoria(registro.userId, 'REDEFINIR_SENHA');
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Senha redefinida com sucesso' });
  }));

  // ---- GET /configuracoes/notificacoes (protegido) ---------------------------
  r.get('/configuracoes/notificacoes', exigeToken, wrap(async (req, res) => {
    const usuario = usuarioDe(req);
    // Leitura nao toca em `atualizadoEm`: cria com os padroes so na primeira vez.
    const pref =
      (await prisma.notificationPreference.findUnique({ where: { userId: usuario.id } })) ??
      (await prisma.notificationPreference.create({ data: { userId: usuario.id } }));
    return enviar(res, 200, { status: 'sucesso', dados: mapPreferencias(pref) });
  }));

  // ---- PUT /configuracoes/notificacoes (protegido) ---------------------------
  r.put('/configuracoes/notificacoes', exigeToken, wrap(async (req, res) => {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const dados: Partial<Record<PrefCampo, boolean>> = {};
    for (const campo of PREF_CAMPOS) {
      const valor = corpo[campo];
      if (valor === undefined) continue;
      if (typeof valor !== 'boolean')
        return erro(res, 400, `O campo ${campo} deve ser verdadeiro ou falso`, 'PREFERENCIA_INVALIDA');
      dados[campo] = valor;
    }
    if (Object.keys(dados).length === 0)
      return erro(res, 400, 'Nenhuma preferência informada', 'PREFERENCIA_INVALIDA');

    const usuario = usuarioDe(req);
    const pref = await prisma.notificationPreference.upsert({
      where: { userId: usuario.id },
      update: dados,
      create: { userId: usuario.id, ...dados },
    });
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Preferências salvas', dados: mapPreferencias(pref) });
  }));

  // ---- POST /treinamentos/:token/concluir (protegido) ------------------------
  // O token e o id do evento de campanha (mesmo usado em GET /treinamentos/:token).
  r.post('/treinamentos/:token/concluir', exigeToken, wrap(async (req, res) => {
    const usuario = usuarioDe(req);
    const evento = await prisma.campaignEvent.findUnique({
      where: { id: req.params.token },
      include: { campaign: true },
    });
    if (!evento) return erro(res, 404, 'Treinamento não encontrado', 'TREINAMENTO_NAO_ENCONTRADO');

    if (!podeVerTreinamento(usuario, evento))
      return erro(res, 403, 'Este treinamento pertence a outro colaborador', 'TREINAMENTO_DE_OUTRO_USUARIO');

    const atualizado = evento.treinou
      ? evento
      : await prisma.campaignEvent.update({ where: { id: evento.id }, data: { treinou: true, treinouEm: new Date() } });
    if (!evento.treinou)
      await registrarAuditoria(usuario.id, 'CONCLUIR_TREINAMENTO', `${evento.campaign.nome} / ${evento.destinatario}`);
    return enviar(res, 200, {
      status: 'sucesso',
      mensagem: 'Treinamento concluído',
      dados: { token: evento.id, concluido: true, concluidoEm: atualizado.treinouEm },
    });
  }));

  // ---- Link do e-mail de phishing (publico, sem login) -----------------------
  // O destinatario chega pelo link `/t/<token>` do e-mail. O token e aleatorio (256
  // bits) e no banco fica so o hash, como na redefinicao de senha. Abrir o link
  // registra a abertura e o clique (uma vez) e entrega o treinamento contextual; a
  // resposta nao expoe ids nem o nome da campanha.
  async function eventoPeloLink(token: string) {
    return prisma.campaignEvent.findUnique({ where: { tokenHash: hashToken(token.trim()) }, include: { campaign: true } });
  }

  r.get('/treinamentos/link/:token', wrap(async (req, res) => {
    const evento = await eventoPeloLink(req.params.token);
    if (!evento) return erro(res, 404, 'Treinamento não encontrado', 'TREINAMENTO_NAO_ENCONTRADO');
    if (!evento.clicadoEm) {
      const agora = new Date();
      await prisma.campaignEvent.update({
        where: { id: evento.id },
        data: { clicadoEm: agora, abertoEm: evento.abertoEm ?? agora },
      });
      await registrarAuditoria(evento.userId, 'CLIQUE_LINK_PHISHING', `${evento.campaign.nome} / ${evento.destinatario}`);
    }
    return enviar(res, 200, { status: 'sucesso', dados: dadosTreinamento(evento) });
  }));

  r.post('/treinamentos/link/:token/concluir', wrap(async (req, res) => {
    const evento = await eventoPeloLink(req.params.token);
    if (!evento) return erro(res, 404, 'Treinamento não encontrado', 'TREINAMENTO_NAO_ENCONTRADO');
    // Concluir sem ter aberto o link nao existe: o clique e pre-requisito do treinamento.
    if (!evento.clicadoEm) return erro(res, 409, 'Abra o treinamento antes de concluí-lo', 'TREINAMENTO_NAO_INICIADO');
    const atualizado = evento.treinou
      ? evento
      : await prisma.campaignEvent.update({ where: { id: evento.id }, data: { treinou: true, treinouEm: new Date() } });
    if (!evento.treinou)
      await registrarAuditoria(evento.userId, 'CONCLUIR_TREINAMENTO', `${evento.campaign.nome} / ${evento.destinatario}`);
    return enviar(res, 200, {
      status: 'sucesso',
      mensagem: 'Treinamento concluído',
      dados: { concluido: true, concluidoEm: atualizado.treinouEm },
    });
  }));

  // ---- Departamentos (Administrador) ------------------------------------------
  r.post('/departamentos', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const ator = usuarioDe(req);
    const { nome } = req.body ?? {};
    if (typeof nome !== 'string' || vazio(nome.trim()))
      return erro(res, 400, 'Nome do departamento é obrigatório', 'NOME_OBRIGATORIO');
    const limpo = nome.trim();
    if (limpo.length > 60) return erro(res, 400, 'Nome do departamento deve ter até 60 caracteres', 'NOME_INVALIDO');
    if ((await resolverDepartamento(limpo)) !== 'invalido')
      return erro(res, 409, 'Departamento já cadastrado', 'DEPARTAMENTO_DUPLICADO');
    const dep = await prisma.department.create({ data: { name: limpo } });
    await registrarAuditoria(ator.id, 'CRIAR_DEPARTAMENTO', dep.name);
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Departamento cadastrado', dados: { id: dep.id, nome: dep.name, usuarios: 0 } });
  }));

  // Departamento com usuarios nao e excluido: quem decide para onde eles vao e o administrador.
  r.delete('/departamentos/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const ator = usuarioDe(req);
    const dep = await prisma.department.findUnique({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } });
    if (!dep) return erro(res, 404, 'Departamento não encontrado', 'DEPARTAMENTO_NAO_ENCONTRADO');
    if (dep._count.users > 0)
      return erro(res, 409, 'Departamento com usuários: mova-os antes de excluir', 'DEPARTAMENTO_EM_USO');
    await prisma.department.delete({ where: { id: dep.id } });
    await registrarAuditoria(ator.id, 'EXCLUIR_DEPARTAMENTO', dep.name);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Departamento excluído' });
  }));

  // ---- DELETE /campanhas/:id (Administrador/Analista) -----------------------
  // Fora do contrato da N2 AT1; existe para remover simulacoes de teste sem mexer no banco.
  r.delete('/campanhas/:id', exigeToken, exigePerfil('Administrador', 'Analista'), wrap(async (req, res) => {
    const ator = usuarioDe(req);
    const campanha = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campanha) return erro(res, 404, 'Campanha não encontrada', 'CAMPANHA_NAO_ENCONTRADA');
    await prisma.$transaction([
      prisma.campaignEvent.deleteMany({ where: { campaignId: campanha.id } }),
      prisma.campaign.delete({ where: { id: campanha.id } }),
    ]);
    await registrarAuditoria(ator.id, 'EXCLUIR_CAMPANHA', `${campanha.id} (${campanha.nome})`);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Campanha excluída' });
  }));

  // ---- PATCH /users/:id (Administrador) --------------------------------------
  r.patch('/users/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const ator = usuarioDe(req);
    const { nome, email, perfil, status, departamento } = req.body ?? {};

    // Validacoes de formato (nao dependem do banco).
    const dados: { nome?: string; email?: string; perfil?: string; status?: string; departmentId?: string | null } = {};
    if (nome !== undefined) {
      if (typeof nome !== 'string' || vazio(nome.trim())) return erro(res, 400, 'Nome é obrigatório', 'NOME_OBRIGATORIO');
      dados.nome = nome.trim();
    }
    if (email !== undefined) {
      if (!emailFormatoValido(email)) return erro(res, 400, 'Email inválido', 'EMAIL_INVALIDO');
      dados.email = normalizarEmail(email);
    }
    if (perfil !== undefined) {
      if (!PERFIS.includes(perfil)) return erro(res, 400, 'Perfil inválido', 'PERFIL_INVALIDO');
      dados.perfil = perfil;
    }
    if (status !== undefined) {
      if (!STATUS_USUARIO.includes(status)) return erro(res, 400, 'Status inválido', 'STATUS_INVALIDO');
      if (req.params.id === ator.id && status === 'Inativo')
        return erro(res, 422, 'Você não pode inativar a própria conta', 'AUTO_INATIVACAO');
      dados.status = status;
    }
    const departmentId = await resolverDepartamento(departamento);
    if (departmentId === 'invalido') return erro(res, 400, 'Departamento inválido', 'DEPARTAMENTO_INVALIDO');
    if (departmentId !== undefined) dados.departmentId = departmentId;
    if (Object.keys(dados).length === 0)
      return erro(res, 400, 'Nenhum campo para atualizar', 'NADA_A_ATUALIZAR');

    // Regras que dependem do estado atual rodam numa transacao (check-then-act atomico).
    const resultado = await prisma.$transaction(async (tx) => {
      const alvo = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!alvo) return falha(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
      if (dados.email !== undefined) {
        const dono = await tx.user.findUnique({ where: { email: dados.email }, select: { id: true } });
        if (dono && dono.id !== alvo.id) return falha(409, 'Email já cadastrado', 'EMAIL_DUPLICADO');
      }
      const eraAdminAtivo = alvo.perfil === 'Administrador' && alvo.status !== 'Inativo';
      const deixaDeSerAdminAtivo =
        (dados.perfil ?? alvo.perfil) !== 'Administrador' || (dados.status ?? alvo.status) === 'Inativo';
      if (eraAdminAtivo && deixaDeSerAdminAtivo) {
        const outrosAdmins = await tx.user.count({
          where: { perfil: 'Administrador', status: { not: 'Inativo' }, id: { not: alvo.id } },
        });
        if (outrosAdmins === 0)
          return falha(409, 'Não é possível rebaixar o único administrador ativo', 'ULTIMO_ADMIN');
      }
      const atualizado = await tx.user.update({ where: { id: alvo.id }, data: dados, select: SELECT_USUARIO });
      return { atualizado };
    });
    if ('falha' in resultado) return erro(res, resultado.falha.status, resultado.falha.mensagem, resultado.falha.codigo);

    await registrarAuditoria(ator.id, 'ATUALIZAR_USUARIO', `${req.params.id}: ${Object.keys(dados).join(', ')}`);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Usuário atualizado', dados: mapUsuario(resultado.atualizado) });
  }));

  // ---- DELETE /users/:id (Administrador) -------------------------------------
  r.delete('/users/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const ator = usuarioDe(req);
    if (req.params.id === ator.id) return erro(res, 422, 'Você não pode excluir a própria conta', 'AUTO_EXCLUSAO');

    const resultado = await prisma.$transaction(async (tx) => {
      const alvo = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!alvo) return falha(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
      if (alvo.perfil === 'Administrador' && alvo.status !== 'Inativo') {
        const outrosAdmins = await tx.user.count({
          where: { perfil: 'Administrador', status: { not: 'Inativo' }, id: { not: alvo.id } },
        });
        if (outrosAdmins === 0)
          return falha(409, 'Não é possível excluir o único administrador ativo', 'ULTIMO_ADMIN');
      }
      // Quem ja participou de campanha nao e excluido (onDelete: Restrict): apagar
      // distorceria as metricas historicas. Inativar a conta tem o mesmo efeito de acesso.
      if (await tx.campaignEvent.count({ where: { userId: alvo.id } }))
        return falha(409, 'Usuário com histórico em campanhas de phishing: inative a conta em vez de excluir', 'USUARIO_COM_HISTORICO');
      // Preferencias e tokens de redefinicao caem em cascata (onDelete: Cascade).
      await tx.user.delete({ where: { id: alvo.id } });
      return { email: alvo.email };
    });
    if ('falha' in resultado) return erro(res, resultado.falha.status, resultado.falha.mensagem, resultado.falha.codigo);

    await registrarAuditoria(ator.id, 'EXCLUIR_USUARIO', `${req.params.id} (${resultado.email})`);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Usuário excluído' });
  }));
}
