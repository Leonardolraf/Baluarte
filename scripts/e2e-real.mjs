#!/usr/bin/env node
// Suíte funcional (Playwright) em MODO REAL, isolada (B15). Sobe tudo, roda e derruba:
//   1. banco descartável no Postgres local (DATABASE_URL do backend/.env com outro nome de
//      banco): `prisma migrate reset` + seed + seed:demo;
//   2. OSV/NVD falsos (scripts/e2e/bases-falsas.mjs): nada de consulta às bases reais;
//   3. API (backend) numa porta própria, com segredo do osquery gerado na hora, VirusTotal
//      desligado, cruzamento automático desligado e e-mail pelo Mailpit;
//   4. Vite com VITE_USE_MOCKS=false e proxy /api para essa API;
//   5. Playwright em `e2e/real/` (E2E_REAL=1). Com ClamAV, roda tudo com o antivírus e depois
//      reinicia a API SEM ele para o teste do 503 (tag @sem-antivirus). Sem ClamAV, uma rodada só
//      e os testes que dependem dele ficam como "skipped";
//   6. derruba API, Vite e bases falsas, apaga o banco e para o que tiver subido no Docker.
// Nunca usa a 8080, a 5173 nem o banco `baluarte`.
//
// Uso (de qualquer pasta): node scripts/e2e-real.mjs [argumentos do playwright test]
//   ou, em baluarte-frontend/: npm run test:e2e:real -- [argumentos]
// Variáveis (padrões entre parênteses):
//   E2E_DB_NAME (baluarte_e2e)  E2E_API_PORT (8097)  E2E_WEB_PORT (5200)  E2E_BASES_PORT (8098)
//   E2E_CLAMAV: auto (usa se o clamd responder) | 1 (exige; sobe o perfil antivirus do Compose
//     se preciso) | 0 (nunca)       E2E_CLAMAV_HOST (127.0.0.1)  E2E_CLAMAV_PORT (3310)
//   E2E_MAILPIT_URL (http://localhost:8025)  E2E_SMTP_HOST (127.0.0.1)  E2E_SMTP_PORT (1025)
//   E2E_KEEP_DB=1 mantém o banco no fim (para investigar).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarBasesFalsas } from './e2e/bases-falsas.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(RAIZ, 'backend');
const FRONTEND = join(RAIZ, 'baluarte-frontend');
const LOGS = join(tmpdir(), 'baluarte-e2e-real');
const WIN = process.platform === 'win32';

const env = process.env;
const DB_NAME = env.E2E_DB_NAME ?? 'baluarte_e2e';
const API_PORT = Number(env.E2E_API_PORT ?? 8097);
const WEB_PORT = Number(env.E2E_WEB_PORT ?? 5200);
const BASES_PORT = Number(env.E2E_BASES_PORT ?? 8098);
const CLAMAV_MODO = env.E2E_CLAMAV ?? 'auto';
const CLAMAV_HOST = env.E2E_CLAMAV_HOST ?? '127.0.0.1';
const CLAMAV_PORT = Number(env.E2E_CLAMAV_PORT ?? 3310);
const MAILPIT_URL = (env.E2E_MAILPIT_URL ?? 'http://localhost:8025').replace(/\/+$/, '');
const SMTP_HOST = env.E2E_SMTP_HOST ?? '127.0.0.1';
const SMTP_PORT = env.E2E_SMTP_PORT ?? '1025';
const PORTAS_PROIBIDAS = new Set([8080, 5173]);
const argsPlaywright = process.argv.slice(2);

const log = (msg) => console.log(`[e2e-real] ${msg}`);
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---- Estado para a limpeza ------------------------------------------------------------
const filhos = new Map(); // nome -> ChildProcess
let pararBases = null;
let bancoCriado = false;
const servicosDocker = []; // serviços do Compose que este script subiu
let urlBanco = '';

function falhar(msg) {
  throw new Error(msg);
}

// ---- Banco ------------------------------------------------------------------------------

/** Lê backend/.env (KEY=VALOR, com ou sem aspas), sem sobrescrever o ambiente. */
function lerEnvBackend() {
  const arquivo = join(BACKEND, '.env');
  const valores = {};
  if (!existsSync(arquivo)) return valores;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    valores[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return valores;
}

/** URL do banco descartável: a do backend com outro nome de banco. Recusa servidor não local. */
function montarUrlBanco() {
  if (!/^baluarte_e2e[a-z0-9_]*$/.test(DB_NAME))
    falhar(`E2E_DB_NAME precisa começar com baluarte_e2e (recebi "${DB_NAME}")`);
  const base = env.DATABASE_URL ?? lerEnvBackend().DATABASE_URL;
  if (!base?.startsWith('postgres')) falhar('DATABASE_URL não encontrada (backend/.env)');
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    falhar(`o banco de teste só pode ficar no Postgres local (DATABASE_URL aponta para ${url.hostname})`);
  url.pathname = `/${DB_NAME}`;
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  return url.toString();
}

function urlAdministrativa() {
  const url = new URL(urlBanco);
  url.pathname = '/postgres';
  url.searchParams.delete('schema');
  return url.toString();
}

/** Roda um comando node em primeiro plano; lança se sair com erro. */
function rodar(nome, args, opcoes) {
  log(`${nome}…`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', ...opcoes });
  if (r.status !== 0) falhar(`${nome} falhou (código ${r.status})`);
}

function envBanco() {
  return { ...env, DATABASE_URL: urlBanco, DIRECT_URL: urlBanco };
}

function prepararBanco() {
  const prisma = join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');
  bancoCriado = true;
  rodar(`banco ${DB_NAME}: migrations do zero`, [prisma, 'migrate', 'reset', '--force', '--skip-seed'], {
    cwd: BACKEND,
    env: envBanco(),
  });
  rodar('seed de contrato', ['--import', 'tsx', 'prisma/seed.ts'], { cwd: BACKEND, env: envBanco() });
  rodar('seed de demonstração', ['--import', 'tsx', 'prisma/seed-demo.ts'], {
    cwd: BACKEND,
    env: envBanco(),
  });
}

function apagarBanco() {
  if (!bancoCriado || env.E2E_KEEP_DB === '1') return;
  const prisma = join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');
  const r = spawnSync(process.execPath, [prisma, 'db', 'execute', '--url', urlAdministrativa(), '--stdin'], {
    cwd: BACKEND,
    input: `DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE);`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  log(r.status === 0 ? `banco ${DB_NAME} apagado` : `não consegui apagar o banco ${DB_NAME} (apague à mão)`);
}

// ---- Rede e serviços --------------------------------------------------------------------

function portaRespondendo(porta, host) {
  return new Promise((ok) => {
    const s = connect({ port: porta, host });
    s.setTimeout(1000);
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('timeout', () => (s.destroy(), ok(false)));
    s.once('error', () => ok(false));
  });
}

async function exigirPortaLivre(porta) {
  if (PORTAS_PROIBIDAS.has(porta)) falhar(`a porta ${porta} é da stack de desenvolvimento; escolha outra`);
  if ((await portaRespondendo(porta, '127.0.0.1')) || (await portaRespondendo(porta, '::1')))
    falhar(`a porta ${porta} já está em uso`);
}

/** PING do clamd (protocolo "z"): true se ele responder PONG. */
function clamdResponde() {
  return new Promise((ok) => {
    const s = connect({ port: CLAMAV_PORT, host: CLAMAV_HOST });
    let texto = '';
    s.setTimeout(3000);
    s.once('connect', () => s.write('zPING\0'));
    s.on('data', (d) => (texto += d.toString()));
    s.once('end', () => ok(texto.replace(/\0/g, '').trim() === 'PONG'));
    s.once('timeout', () => (s.destroy(), ok(false)));
    s.once('error', () => ok(false));
  });
}

async function respondeHttp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function esperar(descricao, condicao, limiteMs) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await pausa(1000);
  }
  falhar(`${descricao}: não ficou pronto em ${Math.round(limiteMs / 1000)} s`);
}

function docker(args) {
  return spawnSync('docker', ['compose', ...args], { cwd: RAIZ, stdio: 'inherit' }).status === 0;
}

async function garantirMailpit() {
  if (await respondeHttp(`${MAILPIT_URL}/api/v1/info`)) return;
  log('Mailpit fora do ar: subindo o serviço mailpit do Compose');
  if (!docker(['up', '-d', 'mailpit'])) falhar('não consegui subir o Mailpit (docker compose up -d mailpit)');
  servicosDocker.push({ servico: 'mailpit', perfil: null });
  await esperar('Mailpit', () => respondeHttp(`${MAILPIT_URL}/api/v1/info`), 60_000);
}

/** Decide se a rodada usa ClamAV; com E2E_CLAMAV=1 sobe o perfil antivirus se preciso. */
async function prepararClamav() {
  if (CLAMAV_MODO === '0') return false;
  if (await clamdResponde()) {
    log(`ClamAV respondendo em ${CLAMAV_HOST}:${CLAMAV_PORT}`);
    return true;
  }
  if (CLAMAV_MODO !== '1') {
    log('ClamAV não respondeu: a rodada segue sem antivírus (testes com ClamAV ficam como skipped)');
    return false;
  }
  log(
    'subindo o ClamAV do Compose (perfil antivirus; precisa de 3 a 4 GiB de RAM e baixa as assinaturas na 1ª vez)',
  );
  if (!docker(['--profile', 'antivirus', 'up', '-d', 'clamav'])) falhar('não consegui subir o ClamAV');
  servicosDocker.push({ servico: 'clamav', perfil: 'antivirus' });
  await esperar('ClamAV', clamdResponde, 10 * 60_000);
  return true;
}

function iniciarFilho(nome, args, opcoes) {
  mkdirSync(LOGS, { recursive: true });
  const arquivo = join(LOGS, `${nome}.log`);
  const saida = createWriteStream(arquivo, { flags: 'a' });
  const filho = spawn(process.execPath, args, { ...opcoes, stdio: ['ignore', 'pipe', 'pipe'] });
  filho.stdout.pipe(saida);
  filho.stderr.pipe(saida);
  filhos.set(nome, filho);
  log(`${nome} iniciado (pid ${filho.pid}; log em ${arquivo})`);
  return filho;
}

async function pararFilho(nome) {
  const filho = filhos.get(nome);
  if (!filho) return;
  filhos.delete(nome);
  if (filho.exitCode !== null) return;
  const saiu = new Promise((ok) => filho.once('exit', ok));
  if (WIN) spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
  else filho.kill('SIGTERM');
  await Promise.race([saiu, pausa(5000)]);
  log(`${nome} parado`);
}

async function iniciarApi({ comClamav, segredo }) {
  const filho = iniciarFilho('api', ['--import', 'tsx', 'src/server.ts'], {
    cwd: BACKEND,
    env: {
      ...envBanco(),
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      JWT_SECRET: segredo.jwt,
      FRONTEND_URL: `http://localhost:${WEB_PORT}`,
      // E-mail: Mailpit (convite e redefinição), nunca um provedor real.
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER: '',
      SMTP_PASS: '',
      BREVO_API_KEY: '',
      // B20: segunda opinião desligada (sem chave) e, por garantia, endereço local morto.
      VIRUSTOTAL_API_KEY: '',
      VIRUSTOTAL_API_URL: 'http://127.0.0.1:9',
      // B14: bases falsas locais; o cruzamento só roda pelo botão.
      OSV_API_URL: `http://127.0.0.1:${BASES_PORT}/osv`,
      NVD_API_URL: `http://127.0.0.1:${BASES_PORT}/nvd`,
      NVD_API_KEY: '',
      CRUZAMENTO_AUTOMATICO: '0',
      VULN_TIMEOUT_MS: '5000',
      // B07: segredo do osquery só desta instância.
      OSQUERY_ENROLL_SECRET: segredo.osquery,
      CLAMAV_HOST: comClamav ? CLAMAV_HOST : '',
      CLAMAV_PORT: String(CLAMAV_PORT),
    },
  });
  await esperar(
    'API',
    async () => {
      if (filho.exitCode !== null)
        falhar(`a API saiu (código ${filho.exitCode}); veja ${join(LOGS, 'api.log')}`);
      return respondeHttp(`http://127.0.0.1:${API_PORT}/health`);
    },
    60_000,
  );
  log(`API em http://127.0.0.1:${API_PORT}/api (${comClamav ? 'com' : 'sem'} ClamAV)`);
}

async function iniciarVite() {
  const vite = join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js');
  const filho = iniciarFilho('vite', [vite, '--port', String(WEB_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env: {
      ...env,
      VITE_USE_MOCKS: 'false',
      VITE_API_BASE_URL: '/api',
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
    },
  });
  await esperar(
    'Vite',
    async () => {
      if (filho.exitCode !== null)
        falhar(`o Vite saiu (código ${filho.exitCode}); veja ${join(LOGS, 'vite.log')}`);
      return respondeHttp(`http://localhost:${WEB_PORT}/login`);
    },
    90_000,
  );
  log(`frontend em http://localhost:${WEB_PORT} (VITE_USE_MOCKS=false)`);
}

/**
 * Roda o Playwright e devolve o código de saída. Assíncrono de propósito: as bases falsas
 * vivem neste processo e precisam do laço de eventos livre para responder à API.
 */
function playwright(extra, { comClamav, segredo }) {
  const cli = join(FRONTEND, 'node_modules', '@playwright', 'test', 'cli.js');
  const filho = spawn(process.execPath, [cli, 'test', ...argsPlaywright, ...extra], {
    cwd: FRONTEND,
    stdio: 'inherit',
    env: {
      ...env,
      E2E_REAL: '1',
      E2E_BASE_URL: `http://localhost:${WEB_PORT}`,
      E2E_API_URL: `http://127.0.0.1:${API_PORT}/api`,
      E2E_MAILPIT_URL: MAILPIT_URL,
      E2E_OSQUERY_SECRET: segredo.osquery,
      E2E_BASES_URL: `http://127.0.0.1:${BASES_PORT}`,
      E2E_CLAMAV: comClamav ? '1' : '0',
    },
  });
  filhos.set('playwright', filho);
  return new Promise((ok) =>
    filho.once('exit', (codigo) => {
      filhos.delete('playwright');
      ok(codigo ?? 1);
    }),
  );
}

// ---- Fluxo ------------------------------------------------------------------------------

async function limpar() {
  await pararFilho('playwright');
  await pararFilho('vite');
  await pararFilho('api');
  if (pararBases) {
    await pararBases();
    pararBases = null;
    log('bases falsas paradas');
  }
  if (urlBanco) apagarBanco();
  for (const { servico, perfil } of servicosDocker.splice(0).reverse()) {
    docker([...(perfil ? ['--profile', perfil] : []), 'stop', servico]);
    log(`serviço ${servico} do Compose parado`);
  }
}

async function principal() {
  for (const porta of [API_PORT, WEB_PORT, BASES_PORT]) await exigirPortaLivre(porta);
  urlBanco = montarUrlBanco();
  rmSync(LOGS, { recursive: true, force: true }); // logs só desta rodada
  const segredo = { osquery: randomBytes(24).toString('hex'), jwt: randomBytes(32).toString('hex') };

  await garantirMailpit();
  const comClamav = await prepararClamav();
  prepararBanco();
  pararBases = await iniciarBasesFalsas(BASES_PORT);
  log(`OSV/NVD falsos em http://127.0.0.1:${BASES_PORT}`);

  await iniciarApi({ comClamav, segredo });
  await iniciarVite();

  let codigo = await playwright([], { comClamav, segredo });
  if (comClamav) {
    log('2ª rodada: API sem ClamAV, só os testes @sem-antivirus');
    await pararFilho('api');
    await iniciarApi({ comClamav: false, segredo });
    const segunda = await playwright(['--grep', '@sem-antivirus', '--pass-with-no-tests'], {
      comClamav: false,
      segredo,
    });
    codigo = codigo || segunda;
  }
  return codigo;
}

let encerrando = false;
async function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  try {
    await limpar();
  } finally {
    process.exit(codigo);
  }
}
process.on('SIGINT', () => void encerrar(130));
process.on('SIGTERM', () => void encerrar(143));

principal()
  .then((codigo) => encerrar(codigo))
  .catch((e) => {
    console.error(`[e2e-real] ${e instanceof Error ? e.message : e}`);
    void encerrar(1);
  });
