// Baluarte — Stub de API para Testes de API (N2 AT1 — Teste de Software)
// -----------------------------------------------------------------------------
// Servidor MÍNIMO, sem dependências externas (módulo http nativo do Node).
// Existe só para permitir executar os testes de API no Postman/Newman e gerar
// evidências reais de execução, já que o projeto Baluarte ainda não tem backend.
//
// Endpoints implementados (apenas os testados):
//   POST /api/login   — autenticação (classes de equivalência de credenciais)
//   POST /api/scans   — disparo de varredura (validação de status do ativo)
//   GET  /health      — sanity check
//
// Uso:  node server.js            (porta padrão 8080)
//       PORT=9090 node server.js  (porta alternativa)
// -----------------------------------------------------------------------------

const http = require('http');

const PORT = process.env.PORT || 8080;

// ---- "Banco" em memória (dados de seed) -------------------------------------
const USUARIOS = [
  { email: 'analista@empresa.com', senha: 'Senha@123', perfil: 'Analista', idUsuario: 'u-001' },
];

const ATIVOS = [
  { id: 'ativo-001', nome: 'Servidor Web de Produção', status: 'Ativo' },
  { id: 'ativo-002', nome: 'Servidor Legado', status: 'Inativo' },
];

// Token opaco simples (não é um JWT real, mas funciona como Bearer no stub).
const TOKEN_VALIDO = 'stub-token-analista-001';

// ---- Helpers ----------------------------------------------------------------
function emailFormatoValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function agora() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function enviar(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// ---- POST /api/login --------------------------------------------------------
function tratarLogin(body, res) {
  const { email, senha } = body;

  if (email === undefined || email === null || email === '') {
    return enviar(res, 400, { status: 'erro', mensagem: 'E-mail é obrigatório', codigoErro: 'EMAIL_OBRIGATORIO', timestamp: agora() });
  }
  if (senha === undefined || senha === null || senha === '') {
    return enviar(res, 400, { status: 'erro', mensagem: 'Senha é obrigatória', codigoErro: 'SENHA_OBRIGATORIA', timestamp: agora() });
  }
  if (!emailFormatoValido(email)) {
    return enviar(res, 400, { status: 'erro', mensagem: 'Formato de e-mail inválido', codigoErro: 'EMAIL_INVALIDO', timestamp: agora() });
  }

  const usuario = USUARIOS.find((u) => u.email === email);
  if (!usuario || usuario.senha !== senha) {
    // Mesma resposta para e-mail não cadastrado e senha incorreta (não vaza qual falhou).
    return enviar(res, 401, { status: 'erro', mensagem: 'E-mail ou senha inválidos', codigoErro: 'CREDENCIAIS_INVALIDAS', timestamp: agora() });
  }

  return enviar(res, 200, {
    status: 'sucesso',
    mensagem: 'Autenticado com sucesso',
    dados: { token: TOKEN_VALIDO, idUsuario: usuario.idUsuario, email: usuario.email, perfil: usuario.perfil },
  });
}

// ---- POST /api/scans --------------------------------------------------------
function tratarScans(headers, body, res) {
  const auth = headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return enviar(res, 401, { status: 'erro', mensagem: 'Token não fornecido', codigoErro: 'TOKEN_AUSENTE', timestamp: agora() });
  }
  if (token !== TOKEN_VALIDO) {
    return enviar(res, 401, { status: 'erro', mensagem: 'Token inválido', codigoErro: 'TOKEN_INVALIDO', timestamp: agora() });
  }

  const { ativoId } = body;
  if (ativoId === undefined || ativoId === null || ativoId === '') {
    return enviar(res, 400, { status: 'erro', mensagem: 'ativoId é obrigatório', codigoErro: 'ATIVO_OBRIGATORIO', timestamp: agora() });
  }

  const ativo = ATIVOS.find((a) => a.id === ativoId);
  if (!ativo) {
    return enviar(res, 404, { status: 'erro', mensagem: 'Ativo não encontrado', codigoErro: 'ATIVO_NAO_ENCONTRADO', timestamp: agora() });
  }
  if (ativo.status !== 'Ativo') {
    return enviar(res, 422, { status: 'erro', mensagem: 'Varredura não permitida: ativo está inativo', codigoErro: 'ATIVO_INATIVO', timestamp: agora() });
  }

  return enviar(res, 201, {
    status: 'sucesso',
    mensagem: 'Varredura enfileirada com sucesso',
    dados: { scanId: 's-' + Math.random().toString(36).slice(2, 8), ativoId: ativo.id, statusVarredura: 'EM_FILA', criadoEm: agora() },
  });
}

// ---- Roteamento -------------------------------------------------------------
const server = http.createServer((req, res) => {
  let chunks = '';
  req.on('data', (c) => { chunks += c; });
  req.on('end', () => {
    let body = {};
    if (chunks) {
      try {
        body = JSON.parse(chunks);
      } catch (e) {
        return enviar(res, 400, { status: 'erro', mensagem: 'JSON inválido no corpo da requisição', codigoErro: 'JSON_INVALIDO', timestamp: agora() });
      }
    }
    const url = req.url.split('?')[0];

    if (req.method === 'POST' && url === '/api/login') return tratarLogin(body, res);
    if (req.method === 'POST' && url === '/api/scans') return tratarScans(req.headers, body, res);
    if (req.method === 'GET' && url === '/health') return enviar(res, 200, { status: 'ok' });

    return enviar(res, 404, { status: 'erro', mensagem: 'Rota não encontrada', codigoErro: 'ROTA_NAO_ENCONTRADA' });
  });
});

server.listen(PORT, () => {
  console.log(`[Baluarte stub] ouvindo em http://localhost:${PORT}`);
});
