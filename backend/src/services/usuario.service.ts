import type { AlteracaoUsuario, Ator, CadastroUsuario, UsuarioAtual } from '../models/usuario.model.js';
import { nomeDoDepartamento, resolverDepartamento } from '../repositories/departamento.repository.js';
import * as repo from '../repositories/usuario.repository.js';
import { falhar } from '../utils/resposta.js';
import { normalizarEmail } from '../utils/validacao.js';
import { registrarAuditoria } from './auditoria.service.js';
import { emitirLinkConta, hashSemSenha } from './linkConta.service.js';

// Regras de usuarios: cadastro por convite (sem senha provisoria), edicao e exclusao com
// a regra do ultimo administrador, e o envio de convite/link de redefinicao pelo operador.

/** Cadastro (contrato N2 AT1). A conta nasce Pendente e recebe o convite por e-mail. */
export async function criar(ator: Ator, entrada: CadastroUsuario) {
  // So o Administrador cria Administrador.
  if (entrada.perfil === 'Administrador' && ator.perfil !== 'Administrador')
    falhar(403, 'Acesso negado para o seu perfil', 'PERFIL_SEM_PERMISSAO');
  // Extensao compativel do contrato: departamento opcional, pelo nome.
  const departmentId = await resolverDepartamento(entrada.departamento);
  if (departmentId === 'invalido') falhar(400, 'Departamento inválido', 'DEPARTAMENTO_INVALIDO');

  const email = normalizarEmail(entrada.email);
  if (await repo.emailEmUso(email)) falhar(409, 'Email já cadastrado', 'EMAIL_DUPLICADO');

  // Nao existe senha provisoria: a conta nasce Pendente, sem senha utilizavel, e a
  // pessoa cria a propria senha pelo link do convite enviado por e-mail.
  const usuario = await repo.criar({
    nome: entrada.nome, email, perfil: entrada.perfil, senhaHash: await hashSemSenha(), departmentId: departmentId ?? null,
  });
  await registrarAuditoria(ator.id, 'CRIAR_USUARIO', `${usuario.id} (${usuario.email}, ${usuario.perfil})`);
  // Falha no envio nao desfaz o cadastro: o convite pode ser reenviado (POST /users/:id/convite).
  const conviteEnviado = await emitirLinkConta(usuario, 'CONVITE');
  if (conviteEnviado) await registrarAuditoria(ator.id, 'ENVIAR_CONVITE', usuario.email);
  return {
    idUsuario: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    departamento: usuario.department?.name ?? null,
    conviteEnviado,
  };
}

export async function listar() {
  const usuarios = await repo.listar();
  const resumo = {
    total: usuarios.length,
    Administrador: usuarios.filter((u) => u.perfil === 'Administrador').length,
    Analista: usuarios.filter((u) => u.perfil === 'Analista').length,
    Colaborador: usuarios.filter((u) => u.perfil === 'Colaborador').length,
  };
  return { usuarios, resumo };
}

/** Dados do usuario logado (GET /me). */
export async function perfilDe(u: UsuarioAtual) {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, status: u.status, departamento: await nomeDoDepartamento(u.departmentId) };
}

/** Edicao pelo Administrador. `dados` ja vem validado no formato; `departamento` vem pelo nome. */
export async function atualizar(ator: Ator, id: string, dados: AlteracaoUsuario, departamento: unknown) {
  const departmentId = await resolverDepartamento(departamento);
  if (departmentId === 'invalido') falhar(400, 'Departamento inválido', 'DEPARTAMENTO_INVALIDO');
  if (departmentId !== undefined) dados.departmentId = departmentId;
  if (Object.keys(dados).length === 0) falhar(400, 'Nenhum campo para atualizar', 'NADA_A_ATUALIZAR');

  // Regras que dependem do estado atual rodam numa transacao (check-then-act atomico).
  const atualizado = await repo.emTransacao(async (tx) => {
    const alvo = await repo.buscarPorId(id, tx);
    if (!alvo) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
    if (dados.email !== undefined) {
      const dono = await repo.donoDoEmail(dados.email, tx);
      if (dono && dono.id !== alvo.id) falhar(409, 'Email já cadastrado', 'EMAIL_DUPLICADO');
    }
    const eraAdminAtivo = alvo.perfil === 'Administrador' && alvo.status !== 'Inativo';
    const deixaDeSerAdminAtivo =
      (dados.perfil ?? alvo.perfil) !== 'Administrador' || (dados.status ?? alvo.status) === 'Inativo';
    if (eraAdminAtivo && deixaDeSerAdminAtivo && (await repo.contarOutrosAdmins(tx, alvo.id)) === 0)
      falhar(409, 'Não é possível rebaixar o único administrador ativo', 'ULTIMO_ADMIN');
    return repo.atualizar(alvo.id, dados, tx);
  });

  await registrarAuditoria(ator.id, 'ATUALIZAR_USUARIO', `${id}: ${Object.keys(dados).join(', ')}`);
  return repo.mapUsuario(atualizado);
}

/** Exclusao pelo Administrador. Quem tem historico de campanha so pode ser inativado. */
export async function excluir(ator: Ator, id: string): Promise<void> {
  if (id === ator.id) falhar(422, 'Você não pode excluir a própria conta', 'AUTO_EXCLUSAO');
  const email = await repo.emTransacao(async (tx) => {
    const alvo = await repo.buscarPorId(id, tx);
    if (!alvo) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
    if (alvo.perfil === 'Administrador' && alvo.status !== 'Inativo' && (await repo.contarOutrosAdmins(tx, alvo.id)) === 0)
      falhar(409, 'Não é possível excluir o único administrador ativo', 'ULTIMO_ADMIN');
    // Quem ja participou de campanha nao e excluido (onDelete: Restrict): apagar
    // distorceria as metricas historicas. Inativar a conta tem o mesmo efeito de acesso.
    if (await repo.contarEventosCampanha(alvo.id, tx))
      falhar(409, 'Usuário com histórico em campanhas de phishing: inative a conta em vez de excluir', 'USUARIO_COM_HISTORICO');
    // Preferencias e tokens de redefinicao caem em cascata (onDelete: Cascade).
    await repo.excluir(alvo.id, tx);
    return alvo.email;
  });
  await registrarAuditoria(ator.id, 'EXCLUIR_USUARIO', `${id} (${email})`);
}

/** Reenvia o convite de uma conta Pendente (Administrador/Analista). */
export async function reenviarConvite(ator: Ator, id: string): Promise<string> {
  const alvo = await repo.buscarPorId(id);
  if (!alvo) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
  // Mesma regra do cadastro: so o Administrador cuida de contas de Administrador.
  if (alvo.perfil === 'Administrador' && ator.perfil !== 'Administrador')
    falhar(403, 'Acesso negado para o seu perfil', 'PERFIL_SEM_PERMISSAO');
  if (alvo.status !== 'Pendente')
    falhar(409, 'O convite só pode ser reenviado para contas pendentes', 'USUARIO_NAO_PENDENTE');
  if (!(await emitirLinkConta(alvo, 'CONVITE')))
    falhar(502, 'Não foi possível enviar o e-mail. Tente novamente.', 'EMAIL_NAO_ENVIADO');
  await registrarAuditoria(ator.id, 'ENVIAR_CONVITE', alvo.email);
  return alvo.email;
}

/**
 * O Administrador dispara o link de redefinicao de um usuario. Rota propria (e nao a
 * publica /auth/reset-password) para registrar QUEM pediu e nao gastar o limite de
 * pedidos do dono da conta. Conta Pendente usa o convite; Inativa nao recebe link.
 */
export async function enviarRedefinicao(ator: Ator, id: string): Promise<string> {
  const alvo = await repo.buscarPorId(id);
  if (!alvo) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
  if (alvo.status !== 'Ativo') falhar(409, 'O link de redefinição só é enviado para contas ativas', 'USUARIO_NAO_ATIVO');
  if (!(await emitirLinkConta(alvo, 'RESET')))
    falhar(502, 'Não foi possível enviar o e-mail. Tente novamente.', 'EMAIL_NAO_ENVIADO');
  await registrarAuditoria(ator.id, 'ENVIAR_RESET_SENHA', alvo.email);
  return alvo.email;
}
