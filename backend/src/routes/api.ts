import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { gerarToken, exigeToken } from '../auth.js';
import { registerReadRoutes } from './read.js';
import {
  erro,
  enviar,
  vazio,
  emailFormatoValido,
  hostValido,
  faixaCvss,
  TIPOS_ATIVO,
  PERFIS,
  TEMPLATES,
  DOMINIO_INTERNO,
} from '../util.js';

export const apiRouter = Router();

// Captura erros assincronos e devolve 500 padronizado.
function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      console.error('[erro interno]', e);
      if (!res.headersSent) erro(res, 500, 'Erro interno no servidor', 'ERRO_INTERNO');
    });
  };
}

// Catalogo de achados simulados para gerar evidencias realistas numa varredura.
const CATALOGO_FINDINGS = [
  { categoriaOwasp: 'A01:2021 - Broken Access Control', cvss: 8.2, descricao: 'Endpoint administrativo acessivel sem verificacao de perfil.', evidencia: 'GET /api/admin/users -> 200 com token de Colaborador.' },
  { categoriaOwasp: 'A03:2021 - Injection', cvss: 9.8, descricao: 'Parametro de busca concatenado diretamente na query SQL.', evidencia: "GET /buscar?q=' OR '1'='1 retornou todos os registros." },
  { categoriaOwasp: 'A02:2021 - Cryptographic Failures', cvss: 6.5, descricao: 'Cookie de sessao sem atributo Secure/HttpOnly.', evidencia: 'Set-Cookie: sid=...; sem flags Secure e HttpOnly.' },
  { categoriaOwasp: 'A05:2021 - Security Misconfiguration', cvss: 5.3, descricao: 'Cabecalho X-Powered-By expoe versao do servidor.', evidencia: 'Response header: X-Powered-By: Express 4.x.' },
  { categoriaOwasp: 'A07:2021 - Identification and Authentication Failures', cvss: 7.4, descricao: 'Ausencia de bloqueio apos multiplas tentativas de login.', evidencia: '100 tentativas em 10s sem rate limit.' },
  { categoriaOwasp: 'A06:2021 - Vulnerable and Outdated Components', cvss: 4.2, descricao: 'Dependencia com CVE conhecido em uso.', evidencia: 'lodash@4.17.11 (CVE-2019-10744).' },
];

function gerarFindings(): typeof CATALOGO_FINDINGS {
  const qtd = 2 + Math.floor(Math.random() * 3); // 2 a 4 achados
  const copia = [...CATALOGO_FINDINGS];
  const escolhidos: typeof CATALOGO_FINDINGS = [];
  for (let i = 0; i < qtd && copia.length; i++) {
    escolhidos.push(copia.splice(Math.floor(Math.random() * copia.length), 1)[0]);
  }
  return escolhidos;
}

// ---- POST /api/login --------------------------------------------------------
apiRouter.post('/login', wrap(async (req, res) => {
  const { email, senha } = req.body ?? {};
  if (vazio(email)) return erro(res, 400, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO');
  if (vazio(senha)) return erro(res, 400, 'Senha é obrigatória', 'SENHA_OBRIGATORIA');
  if (!emailFormatoValido(email)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');

  const usuario = await prisma.user.findUnique({ where: { email } });
  const ok = usuario ? await bcrypt.compare(String(senha), usuario.senhaHash) : false;
  if (!usuario || !ok) return erro(res, 401, 'E-mail ou senha inválidos', 'CREDENCIAIS_INVALIDAS');

  const token = gerarToken({ idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil });
  return enviar(res, 200, {
    status: 'sucesso',
    mensagem: 'Autenticado com sucesso',
    dados: { token, idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil },
  });
}));

// ---- POST /api/scans (protegido) --------------------------------------------
apiRouter.post('/scans', exigeToken, wrap(async (req, res) => {
  const { ativoId } = req.body ?? {};
  if (vazio(ativoId)) return erro(res, 400, 'ativoId é obrigatório', 'ATIVO_OBRIGATORIO');

  const ativo = await prisma.asset.findUnique({ where: { id: String(ativoId) } });
  if (!ativo) return erro(res, 404, 'Ativo não encontrado', 'ATIVO_NAO_ENCONTRADO');
  if (ativo.status !== 'Ativo') return erro(res, 422, 'Varredura não permitida: ativo está inativo', 'ATIVO_INATIVO');

  const scan = await prisma.scan.create({ data: { assetId: ativo.id, status: 'EM_FILA' } });
  // Varredura simulada: gera achados realistas ligados ao scan.
  await prisma.finding.createMany({
    data: gerarFindings().map((f) => ({ ...f, scanId: scan.id, severidade: faixaCvss(f.cvss) })),
  });

  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Varredura enfileirada com sucesso',
    dados: { scanId: scan.id, ativoId: ativo.id, statusVarredura: 'EM_FILA', criadoEm: scan.criadoEm.toISOString() },
  });
}));

// ---- POST /api/assets (protegido) -------------------------------------------
apiRouter.post('/assets', exigeToken, wrap(async (req, res) => {
  const { nome, tipo, host } = req.body ?? {};
  if (vazio(nome)) return erro(res, 400, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO');
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

// ---- POST /api/users (protegido) --------------------------------------------
apiRouter.post('/users', exigeToken, wrap(async (req, res) => {
  const { nome, email, perfil } = req.body ?? {};
  if (vazio(nome)) return erro(res, 400, 'Nome é obrigatório', 'NOME_OBRIGATORIO');
  if (!emailFormatoValido(email)) return erro(res, 400, 'Email inválido', 'EMAIL_INVALIDO');
  if (!PERFIS.includes(perfil)) return erro(res, 400, 'Perfil inválido', 'PERFIL_INVALIDO');

  const dup = await prisma.user.findUnique({ where: { email } });
  if (dup) return erro(res, 409, 'Email já cadastrado', 'EMAIL_DUPLICADO');

  const senhaHash = await bcrypt.hash('Mudar@123', 10);
  const usuario = await prisma.user.create({ data: { nome, email, perfil, senhaHash, status: 'Pendente' } });
  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Usuário cadastrado com sucesso',
    dados: { idUsuario: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
  });
}));

// ---- POST /api/campaigns (protegido) ----------------------------------------
apiRouter.post('/campaigns', exigeToken, wrap(async (req, res) => {
  const { nome, destinatario, template } = req.body ?? {};
  if (vazio(nome)) return erro(res, 400, 'Nome da campanha é obrigatório', 'NOME_OBRIGATORIO');
  if (!emailFormatoValido(destinatario)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
  if (!String(destinatario).trim().toLowerCase().endsWith(DOMINIO_INTERNO))
    return erro(res, 422, 'Destinatário não autorizado: apenas e-mails internos', 'DESTINATARIO_EXTERNO');
  if (!TEMPLATES.includes(template)) return erro(res, 400, 'Template é obrigatório', 'TEMPLATE_OBRIGATORIO');

  const campanha = await prisma.campaign.create({ data: { nome, template, status: 'AGENDADA' } });
  await prisma.campaignEvent.create({ data: { campaignId: campanha.id, destinatario: String(destinatario).trim() } });

  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Campanha criada com sucesso',
    dados: { idCampanha: campanha.id, nome: campanha.nome, destinatario: String(destinatario).trim(), template: campanha.template, status: campanha.status },
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
