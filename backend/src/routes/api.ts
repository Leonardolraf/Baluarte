import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { gerarToken, exigeToken, exigePerfil, usuarioDe } from '../auth.js';
import { emailEmUso, localizarPorEmail, normalizarEmail, resolverDepartamento } from '../usuarios.js';
import { gerarTokenLink, hashToken } from '../tokens.js';
import { emitirLinkConta, hashSemSenha } from '../conta.js';
import { registrarAuditoria } from '../audit.js';
import { CATALOGO_ACHADOS, dadosAchado, type ChaveAchado } from '../catalogo.js';
import { registerReadRoutes } from './read.js';
import { registerManageRoutes } from './manage.js';
import {
  erro,
  enviar,
  wrap,
  vazio,
  textoPreenchido,
  emailFormatoValido,
  hostValido,
  faixaCvss,
  TIPOS_ATIVO,
  PERFIS,
  TEMPLATES,
  DOMINIO_INTERNO,
} from '../util.js';

export const apiRouter = Router();

// Perfis que operam a plataforma (varreduras, ativos, campanhas, cadastro de usuarios).
const OPERADORES = ['Administrador', 'Analista'];

// ---- Limite de tentativas de login (politica publicada em /configuracoes/seguranca) ----
// As falhas ficam no banco (tabela LoginFailure), por e-mail digitado: o bloqueio vale
// depois de reiniciar a API e cobre tambem e-mails que nao existem.
const LOGIN_JANELA_MS = 15 * 60 * 1000;
const LOGIN_MAX_FALHAS = 5;
// Hash de sacrificio: mantem o custo do bcrypt igual quando o e-mail nao existe
// (sem isso o tempo de resposta revelaria quais e-mails estao cadastrados).
const HASH_SACRIFICIO = bcrypt.hashSync('baluarte-sem-usuario', 10);

function inicioDaJanela(): Date {
  return new Date(Date.now() - LOGIN_JANELA_MS);
}

function falhasRecentes(chave: string): Promise<number> {
  return prisma.loginFailure.count({ where: { email: chave, criadoEm: { gte: inicioDaJanela() } } });
}

/** Registra a falha e devolve quantas a conta acumula na janela. */
async function registrarFalhaLogin(chave: string): Promise<number> {
  await prisma.loginFailure.create({ data: { email: chave } });
  // Poda: o que saiu da janela nao conta mais (endpoint publico: a tabela nao cresce sem limite).
  await prisma.loginFailure.deleteMany({ where: { criadoEm: { lt: inicioDaJanela() } } });
  return falhasRecentes(chave);
}

/** Zera o limitador de login (usado pelos testes). */
export async function limparLimiteLogin(): Promise<void> {
  await prisma.loginFailure.deleteMany();
}

// Varredura simulada: sorteia de 2 a 4 tipos distintos do catalogo (src/catalogo.ts).
function gerarFindings() {
  const qtd = 2 + Math.floor(Math.random() * 3);
  const chaves = Object.keys(CATALOGO_ACHADOS) as ChaveAchado[];
  const escolhidos: ChaveAchado[] = [];
  for (let i = 0; i < qtd && chaves.length; i++) {
    escolhidos.push(chaves.splice(Math.floor(Math.random() * chaves.length), 1)[0]);
  }
  return escolhidos.map(dadosAchado);
}

// ---- POST /api/login --------------------------------------------------------
apiRouter.post('/login', wrap(async (req, res) => {
  const { email, senha } = req.body ?? {};
  if (vazio(email)) return erro(res, 400, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO');
  if (typeof senha !== 'string' || vazio(senha)) return erro(res, 400, 'Senha é obrigatória', 'SENHA_OBRIGATORIA');
  if (!emailFormatoValido(email)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');

  const chave = normalizarEmail(email);
  if ((await falhasRecentes(chave)) >= LOGIN_MAX_FALHAS)
    return erro(res, 429, 'Muitas tentativas de login. Aguarde alguns minutos.', 'MUITAS_TENTATIVAS');

  const usuario = await localizarPorEmail(String(email));
  const ok = await bcrypt.compare(String(senha), usuario ? usuario.senhaHash : HASH_SACRIFICIO);
  if (!usuario || !ok) {
    const falhas = await registrarFalhaLogin(chave);
    if (usuario && falhas === LOGIN_MAX_FALHAS)
      await registrarAuditoria(usuario.id, 'LOGIN_BLOQUEADO', `${LOGIN_MAX_FALHAS} falhas em 15 min`);
    return erro(res, 401, 'E-mail ou senha inválidos', 'CREDENCIAIS_INVALIDAS');
  }
  if (usuario.status === 'Inativo')
    return erro(res, 403, 'Usuário inativo. Contate o administrador.', 'USUARIO_INATIVO');
  // Quem ainda nao aceitou o convite entra so pelo link (contas antigas com senha
  // provisoria tambem caem aqui). So chega aqui quem acertou a senha: nada e revelado.
  if (usuario.status === 'Pendente')
    return erro(res, 403, 'Conta ainda não ativada. Crie sua senha pelo link do convite.', 'CONTA_PENDENTE');
  await prisma.loginFailure.deleteMany({ where: { email: chave } });
  await registrarAuditoria(usuario.id, 'LOGIN');

  const token = gerarToken({ idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil });
  return enviar(res, 200, {
    status: 'sucesso',
    mensagem: 'Autenticado com sucesso',
    dados: { token, idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil },
  });
}));

// ---- POST /api/scans (Administrador/Analista) --------------------------------
apiRouter.post('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
  const { ativoId } = req.body ?? {};
  if (vazio(ativoId)) return erro(res, 400, 'ativoId é obrigatório', 'ATIVO_OBRIGATORIO');

  const ativo = await prisma.asset.findUnique({ where: { id: String(ativoId) } });
  if (!ativo) return erro(res, 404, 'Ativo não encontrado', 'ATIVO_NAO_ENCONTRADO');
  if (ativo.status !== 'Ativo') return erro(res, 422, 'Varredura não permitida: ativo está inativo', 'ATIVO_INATIVO');

  const scan = await prisma.scan.create({ data: { assetId: ativo.id, status: 'EM_FILA' } });
  // Varredura simulada: gera achados realistas ligados ao scan.
  await prisma.finding.createMany({
    data: gerarFindings().map((f) => ({ ...f, scanId: scan.id })),
  });

  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Varredura enfileirada com sucesso',
    dados: { scanId: scan.id, ativoId: ativo.id, statusVarredura: 'EM_FILA', criadoEm: scan.criadoEm.toISOString() },
  });
}));

// ---- POST /api/assets (Administrador/Analista) -------------------------------
apiRouter.post('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
  const { nome, tipo, host } = req.body ?? {};
  if (!textoPreenchido(nome)) return erro(res, 400, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO');
  if (!TIPOS_ATIVO.includes(tipo)) return erro(res, 400, 'Tipo de ativo inválido', 'TIPO_INVALIDO');
  if (!hostValido(host)) return erro(res, 400, 'Host inválido', 'HOST_INVALIDO');

  const hostNorm = String(host).trim();
  const dup = await prisma.asset.findUnique({ where: { host: hostNorm } });
  if (dup) return erro(res, 409, 'Ativo já cadastrado', 'ATIVO_DUPLICADO');

  const ativo = await prisma.asset.create({ data: { nome, tipo, host: hostNorm, status: 'Ativo' } });
  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Ativo cadastrado com sucesso',
    dados: { id: ativo.id, nome: ativo.nome, tipo: ativo.tipo, host: ativo.host, status: ativo.status },
  });
}));

// ---- POST /api/users (Administrador/Analista; so Administrador cria Administrador) ----
apiRouter.post('/users', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
  const { nome, email, perfil, departamento } = req.body ?? {};
  if (!textoPreenchido(nome)) return erro(res, 400, 'Nome é obrigatório', 'NOME_OBRIGATORIO');
  if (!emailFormatoValido(email)) return erro(res, 400, 'Email inválido', 'EMAIL_INVALIDO');
  if (!PERFIS.includes(perfil)) return erro(res, 400, 'Perfil inválido', 'PERFIL_INVALIDO');
  if (perfil === 'Administrador' && usuarioDe(req).perfil !== 'Administrador')
    return erro(res, 403, 'Acesso negado para o seu perfil', 'PERFIL_SEM_PERMISSAO');
  // Extensao compativel do contrato: departamento opcional, pelo nome.
  const departmentId = await resolverDepartamento(departamento);
  if (departmentId === 'invalido') return erro(res, 400, 'Departamento inválido', 'DEPARTAMENTO_INVALIDO');

  const emailNorm = normalizarEmail(email);
  if (await emailEmUso(emailNorm)) return erro(res, 409, 'Email já cadastrado', 'EMAIL_DUPLICADO');

  // Nao existe senha provisoria: a conta nasce Pendente, sem senha utilizavel, e a
  // pessoa cria a propria senha pelo link do convite enviado por e-mail.
  const usuario = await prisma.user.create({
    data: { nome, email: emailNorm, perfil, senhaHash: await hashSemSenha(), status: 'Pendente', departmentId: departmentId ?? null },
    include: { department: true },
  });
  const ator = usuarioDe(req);
  await registrarAuditoria(ator.id, 'CRIAR_USUARIO', `${usuario.id} (${usuario.email}, ${usuario.perfil})`);
  // Falha no envio nao desfaz o cadastro: o convite pode ser reenviado (POST /users/:id/convite).
  const conviteEnviado = await emitirLinkConta(usuario, 'CONVITE');
  if (conviteEnviado) await registrarAuditoria(ator.id, 'ENVIAR_CONVITE', usuario.email);
  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Usuário cadastrado com sucesso',
    dados: {
      idUsuario: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      departamento: usuario.department?.name ?? null,
      conviteEnviado,
    },
  });
}));

// ---- POST /api/campaigns (Administrador/Analista) ----------------------------
// Contrato original: um `destinatario`. Extensao compativel: `destinatarios[]`
// (o frontend novo envia os dois; o Postman/Robot continuam enviando so o primeiro).
apiRouter.post('/campaigns', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
  const { nome, destinatario, destinatarios, template } = req.body ?? {};
  if (!textoPreenchido(nome)) return erro(res, 400, 'Nome da campanha é obrigatório', 'NOME_OBRIGATORIO');

  const brutos: unknown[] = Array.isArray(destinatarios) && destinatarios.length > 0 ? destinatarios : [destinatario];
  const lista: string[] = [];
  for (const item of brutos) {
    if (!emailFormatoValido(item)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
    const email = String(item).trim();
    if (!email.toLowerCase().endsWith(DOMINIO_INTERNO))
      return erro(res, 422, 'Destinatário não autorizado: apenas e-mails internos', 'DESTINATARIO_EXTERNO');
    if (!lista.some((e) => e.toLowerCase() === email.toLowerCase())) lista.push(email);
  }
  if (!TEMPLATES.includes(template)) return erro(res, 400, 'Template é obrigatório', 'TEMPLATE_OBRIGATORIO');

  // So recebe campanha quem esta cadastrado e nao esta Inativo (e-mail citext: ignora maiusculas).
  const usuarios = await prisma.user.findMany({
    where: { email: { in: lista.map((e) => e.toLowerCase()) } },
    select: { id: true, email: true, status: true },
  });
  const destinos: { userId: string; email: string }[] = [];
  for (const email of lista) {
    const u = usuarios.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u || u.status === 'Inativo')
      return erro(res, 422, `Destinatário não cadastrado ou inativo: ${email}`, 'DESTINATARIO_NAO_CADASTRADO');
    destinos.push({ userId: u.id, email: u.email });
  }

  // Cada destinatario recebe um token proprio para o link do e-mail; no banco fica so o hash.
  const tokens = destinos.map(() => gerarTokenLink());
  const campanha = await prisma.campaign.create({
    data: {
      nome,
      template,
      status: 'AGENDADA',
      eventos: {
        create: destinos.map((d, i) => ({ userId: d.userId, destinatario: d.email, tokenHash: hashToken(tokens[i]) })),
      },
    },
  });
  // Nao ha envio de e-mail neste projeto: fora de producao, e so com
  // TREINAMENTO_LINK_CONSOLE=1, o link de cada destinatario vai para o log do servidor.
  if (process.env.NODE_ENV !== 'production' && process.env.TREINAMENTO_LINK_CONSOLE === '1') {
    const base = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    destinos.forEach((d, i) => console.log(`[campanha] link de ${d.email}: ${base}/t/${tokens[i]}`));
  }

  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Campanha criada com sucesso',
    dados: {
      idCampanha: campanha.id,
      nome: campanha.nome,
      destinatario: destinos[0].email,
      destinatarios: destinos.map((d) => d.email),
      template: campanha.template,
      status: campanha.status,
    },
  });
}));

// ---- GET /api/findings/classificacao?cvss=X (publico, sem token) ------------
apiRouter.get('/findings/classificacao', wrap(async (req, res) => {
  const raw = req.query.cvss;
  const cvss = Number(raw);
  if (raw === undefined || raw === '' || Number.isNaN(cvss) || cvss < 0 || cvss > 10)
    return erro(res, 400, 'CVSS deve estar entre 0.0 e 10.0', 'CVSS_INVALIDO');
  return enviar(res, 200, { status: 'sucesso', dados: { cvss, faixa: faixaCvss(cvss) } });
}));

// Endpoints de leitura/agregacao que alimentam as telas do frontend.
registerReadRoutes(apiRouter);
// Endpoints de escrita adicionais (conta, treinamento, gestao de usuarios).
registerManageRoutes(apiRouter);
