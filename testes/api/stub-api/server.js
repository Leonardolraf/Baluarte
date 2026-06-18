// Baluarte — Stub de API para Testes de API (N2 AT1 — Teste de Software)
// -----------------------------------------------------------------------------
// Servidor MÍNIMO, sem dependências externas (módulo http nativo do Node).
// Existe só para permitir executar os testes de API no Postman/Newman e gerar
// evidências reais de execução, já que o projeto Baluarte ainda não tem backend.
//
// Endpoints implementados:
//   POST /api/login                      — autenticação (Leonardo)
//   POST /api/scans                      — disparo de varredura (Leonardo)
//   POST /api/assets                     — cadastro de ativo (Edson)
//   POST /api/users                      — cadastro de usuário (Edson)
//   POST /api/campaigns                  — criação de campanha de phishing (André)
//   GET  /api/findings/classificacao     — classificação de severidade por CVSS (André)
//   GET  /health                         — sanity check
//
// Uso:  node server.js            (porta padrão 8080)
// -----------------------------------------------------------------------------

const http = require('http');

const PORT = process.env.PORT || 8080;

// ---- "Banco" em memória (dados de seed) -------------------------------------
const USUARIOS = [
  { email: 'analista@empresa.com', senha: 'Senha@123', perfil: 'Analista', idUsuario: 'u-001' },
];
const ATIVOS = [
  { id: 'ativo-001', nome: 'Servidor Web de Produção', host: '192.168.0.10', tipo: 'Servidor', status: 'Ativo' },
  { id: 'ativo-002', nome: 'Servidor Legado', host: '192.168.0.20', tipo: 'Servidor', status: 'Inativo' },
];
const TOKEN_VALIDO = 'stub-token-analista-001';
const TIPOS_ATIVO = ['Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'];
const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
const TEMPLATES = ['urgencia', 'autoridade', 'curiosidade'];
const DOMINIO_INTERNO = '@empresa.com';

// ---- Helpers ----------------------------------------------------------------
function emailFormatoValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function hostValido(host) {
  if (typeof host !== 'string' || host.trim() === '') return false;
  const h = host.trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = h.match(ipv4);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  // hostname / domínio (precisa de pelo menos um ponto e caracteres válidos)
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h);
}
function vazio(v) {
  return v === undefined || v === null || v === '';
}
function agora() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function enviar(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}
function erro(res, status, mensagem, codigoErro) {
  return enviar(res, status, { status: 'erro', mensagem, codigoErro, timestamp: agora() });
}
function novoId(prefixo) {
  return prefixo + '-' + Math.random().toString(36).slice(2, 8);
}
function exigeToken(headers, res) {
  const auth = headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return (erro(res, 401, 'Token não fornecido', 'TOKEN_AUSENTE'), false);
  if (token !== TOKEN_VALIDO) return (erro(res, 401, 'Token inválido', 'TOKEN_INVALIDO'), false);
  return true;
}

// ---- POST /api/login (Leonardo) ---------------------------------------------
function tratarLogin(body, res) {
  const { email, senha } = body;
  if (vazio(email)) return erro(res, 400, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO');
  if (vazio(senha)) return erro(res, 400, 'Senha é obrigatória', 'SENHA_OBRIGATORIA');
  if (!emailFormatoValido(email)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
  const usuario = USUARIOS.find((u) => u.email === email);
  if (!usuario || usuario.senha !== senha) return erro(res, 401, 'E-mail ou senha inválidos', 'CREDENCIAIS_INVALIDAS');
  return enviar(res, 200, {
    status: 'sucesso', mensagem: 'Autenticado com sucesso',
    dados: { token: TOKEN_VALIDO, idUsuario: usuario.idUsuario, email: usuario.email, perfil: usuario.perfil },
  });
}

// ---- POST /api/scans (Leonardo) ---------------------------------------------
function tratarScans(headers, body, res) {
  if (!exigeToken(headers, res)) return;
  const { ativoId } = body;
  if (vazio(ativoId)) return erro(res, 400, 'ativoId é obrigatório', 'ATIVO_OBRIGATORIO');
  const ativo = ATIVOS.find((a) => a.id === ativoId);
  if (!ativo) return erro(res, 404, 'Ativo não encontrado', 'ATIVO_NAO_ENCONTRADO');
  if (ativo.status !== 'Ativo') return erro(res, 422, 'Varredura não permitida: ativo está inativo', 'ATIVO_INATIVO');
  return enviar(res, 201, {
    status: 'sucesso', mensagem: 'Varredura enfileirada com sucesso',
    dados: { scanId: novoId('s'), ativoId: ativo.id, statusVarredura: 'EM_FILA', criadoEm: agora() },
  });
}

// ---- POST /api/assets (Edson — Partição de Equivalência) --------------------
function tratarAssets(headers, body, res) {
  if (!exigeToken(headers, res)) return;
  const { nome, tipo, host } = body;
  if (vazio(nome)) return erro(res, 400, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO');
  if (!TIPOS_ATIVO.includes(tipo)) return erro(res, 400, 'Tipo de ativo inválido', 'TIPO_INVALIDO');
  if (!hostValido(host)) return erro(res, 400, 'Host inválido', 'HOST_INVALIDO');
  if (ATIVOS.some((a) => a.host === String(host).trim())) return erro(res, 409, 'Ativo já cadastrado', 'ATIVO_DUPLICADO');
  const ativo = { id: novoId('ativo'), nome, tipo, host: String(host).trim(), status: 'Ativo' };
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Ativo cadastrado com sucesso', dados: ativo });
}

// ---- POST /api/users (Edson — Tabela de Decisão) ----------------------------
function tratarUsers(headers, body, res) {
  if (!exigeToken(headers, res)) return;
  const { nome, email, perfil } = body;
  if (vazio(nome)) return erro(res, 400, 'Nome é obrigatório', 'NOME_OBRIGATORIO');
  if (!emailFormatoValido(email)) return erro(res, 400, 'Email inválido', 'EMAIL_INVALIDO');
  if (!PERFIS.includes(perfil)) return erro(res, 400, 'Perfil inválido', 'PERFIL_INVALIDO');
  if (USUARIOS.some((u) => u.email === email)) return erro(res, 409, 'Email já cadastrado', 'EMAIL_DUPLICADO');
  const usuario = { idUsuario: novoId('u'), nome, email, perfil };
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Usuário cadastrado com sucesso', dados: usuario });
}

// ---- POST /api/campaigns (André — Partição de Equivalência) -----------------
function tratarCampaigns(headers, body, res) {
  if (!exigeToken(headers, res)) return;
  const { nome, destinatario, template } = body;
  if (vazio(nome)) return erro(res, 400, 'Nome da campanha é obrigatório', 'NOME_OBRIGATORIO');
  if (!emailFormatoValido(destinatario)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
  if (!String(destinatario).trim().toLowerCase().endsWith(DOMINIO_INTERNO))
    return erro(res, 422, 'Destinatário não autorizado: apenas e-mails internos', 'DESTINATARIO_EXTERNO');
  if (!TEMPLATES.includes(template)) return erro(res, 400, 'Template é obrigatório', 'TEMPLATE_OBRIGATORIO');
  const campanha = { idCampanha: novoId('camp'), nome, destinatario, template, status: 'AGENDADA' };
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Campanha criada com sucesso', dados: campanha });
}

// ---- GET /api/findings/classificacao?cvss=X (André — Valor de Borda) --------
function tratarClassificacao(query, res) {
  const raw = query.get('cvss');
  const cvss = Number(raw);
  if (raw === null || raw === '' || Number.isNaN(cvss) || cvss < 0 || cvss > 10)
    return erro(res, 400, 'CVSS deve estar entre 0.0 e 10.0', 'CVSS_INVALIDO');
  let faixa;
  if (cvss <= 3.9) faixa = 'Baixo';
  else if (cvss <= 6.9) faixa = 'Médio';
  else if (cvss <= 8.9) faixa = 'Alto';
  else faixa = 'Crítico';
  return enviar(res, 200, { status: 'sucesso', dados: { cvss, faixa } });
}

// ---- Roteamento -------------------------------------------------------------
const server = http.createServer((req, res) => {
  let chunks = '';
  req.on('data', (c) => { chunks += c; });
  req.on('end', () => {
    let body = {};
    if (chunks) {
      try { body = JSON.parse(chunks); }
      catch (e) { return erro(res, 400, 'JSON inválido no corpo da requisição', 'JSON_INVALIDO'); }
    }
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const path = u.pathname;

    if (req.method === 'POST' && path === '/api/login') return tratarLogin(body, res);
    if (req.method === 'POST' && path === '/api/scans') return tratarScans(req.headers, body, res);
    if (req.method === 'POST' && path === '/api/assets') return tratarAssets(req.headers, body, res);
    if (req.method === 'POST' && path === '/api/users') return tratarUsers(req.headers, body, res);
    if (req.method === 'POST' && path === '/api/campaigns') return tratarCampaigns(req.headers, body, res);
    if (req.method === 'GET' && path === '/api/findings/classificacao') return tratarClassificacao(u.searchParams, res);
    if (req.method === 'GET' && path === '/health') return enviar(res, 200, { status: 'ok' });

    return erro(res, 404, 'Rota não encontrada', 'ROTA_NAO_ENCONTRADA');
  });
});

server.listen(PORT, () => {
  console.log(`[Baluarte stub] ouvindo em http://localhost:${PORT}`);
});
