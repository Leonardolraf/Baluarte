#!/usr/bin/env node
// Teste de carga da API (B30, RNF-004), reprodutível e ISOLADO. Sobe, mede e derruba tudo:
//   1. banco descartável no Postgres local (DATABASE_URL do backend/.env com outro nome de banco,
//      padrão baluarte_carga): `prisma migrate reset` + seed + seed:demo + seed:carga (massa com
//      1.200 achados a mais, para a lista paginada e o PDF terem volume);
//   2. API numa porta própria (padrão 8100) com NODE_ENV=production, JWT_SECRET gerado na hora,
//      e-mail desligado e serviços externos apontando para um endereço local morto;
//   3. cenários com o autocannon (versão fixa em devDependencies): dashboard, vulnerabilidades
//      paginadas e ativos com 200 conexões simultâneas (os "200 usuários" do RNF-004), PDF do
//      relatório, login com credenciais válidas e o limite de tentativas de login;
//   4. relatório em testes/carga/RELATORIO.md (+ resultados.json) e, no fim, para a API e apaga
//      o banco.
// Nunca usa a 8080, a 5173, o banco `baluarte` nem servidor que não seja local (nada de Vercel
// ou Supabase).
//
// Uso: cd backend && npm run carga
// Modos (mesma preparação de banco e API, mesma limpeza no fim):
//   npm run carga            → cenários no autocannon, relatório em testes/carga/RELATORIO.md;
//   npm run carga:jmeter     → os mesmos cenários no Apache JMeter (plano testes/carga/jmeter/
//                              baluarte-carga.jmx, modo sem interface), relatório HTML do JMeter em
//                              testes/carga/jmeter/relatorio-html/ e resumo em testes/carga/jmeter/
//                              RELATORIO.md. Precisa de JMETER_HOME (pasta do JMeter 5.6.3);
//   npm run carga:ambiente   → só sobe banco e API e espera Ctrl+C (para abrir o .jmx na interface
//                              do JMeter); mostra as propriedades -J a usar.
// Variáveis (padrões entre parênteses): CARGA_DB_NAME (baluarte_carga, precisa começar assim)
//   CARGA_API_PORT (8100)  CARGA_CONEXOES (200)  CARGA_DURACAO (30, em segundos, por cenário)
//   CARGA_CONEXOES_LOGIN (50)  CARGA_KEEP_DB=1 mantém o banco no fim (para investigar).
import autocannon from 'autocannon';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { cpus, release, tmpdir, totalmem, type as tipoSo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = join(BACKEND, '..');
const SAIDA = join(RAIZ, 'testes', 'carga');
// Rodada de referência (antes da correção do dashboard no B30), comparada no relatório se existir.
const ANTES = join(SAIDA, 'resultados-antes-b30.json');
const LOGS = join(tmpdir(), 'baluarte-carga');
const WIN = process.platform === 'win32';

const env = process.env;
const DB_NAME = env.CARGA_DB_NAME ?? 'baluarte_carga';
const API_PORT = Number(env.CARGA_API_PORT ?? 8100);
const CONEXOES = Number(env.CARGA_CONEXOES ?? 200);
const DURACAO = Number(env.CARGA_DURACAO ?? 30);
const CONEXOES_LOGIN = Number(env.CARGA_CONEXOES_LOGIN ?? 50);
const PORTAS_PROIBIDAS = new Set([8080, 5173]);
const BASE = `http://127.0.0.1:${API_PORT}`;
const MODO = process.argv.includes('--jmeter') ? 'jmeter' : process.argv.includes('--ambiente') ? 'ambiente' : 'autocannon';
// PDF com 1 usuário: desde o DT36 a exportação tem vaga única (a segunda simultânea leva 429
// EXPORTACAO_EM_ANDAMENTO). Com 10 conexões, 98% das respostas eram 429 rápidos e o p95 saía
// "atende" (falso verde achado em 24/11/2026). A regra da vaga única é conferida à parte
// (EXPORTACOES_SIMULTANEAS pedidos ao mesmo tempo: exatamente 1 × 200 e o resto 429).
const CONEXOES_PDF = 1;
const EXPORTACOES_SIMULTANEAS = 3;
const TENTATIVAS_LIMITE = 20;
const EMAIL_LIMITE = 'ana.souza@empresa.com';
// Contas cujos tokens se revezam nas rotas autenticadas (null = senha do seed:demo, DT32).
const CONTAS_TOKEN = [
  ['admin@empresa.com', 'Admin@123'],
  ['analista@empresa.com', 'Senha@123'],
  ['edson@empresa.com', null],
];
// Contas do cenário de login com senha certa (todas da massa de demonstração).
const CONTAS_LOGIN = ['edson@empresa.com', 'ana.souza@empresa.com', 'bruno.lima@empresa.com'].concat(
  Array.from({ length: 203 }, (_, i) => `colab${i}@empresa.com`),
);

const log = (msg) => console.log(`[carga] ${msg}`);
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const falhar = (msg) => {
  throw new Error(msg);
};

let api = null;
let urlBanco = '';
let bancoCriado = false;
// DT32: o seed:demo gera uma senha aleatória por conta e grava fora do repositório. A carga usa um
// temporário próprio, lê as senhas dele para os logins e o apaga no fim (nunca imprime nenhuma).
let pastaSenhasDemo = null;
let senhasDemo = new Map();

function lerSenhasDemo(arquivo) {
  const senhas = new Map();
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    if (!linha || linha.startsWith('#')) continue;
    const [email, , senha] = linha.split('\t');
    if (email && senha) senhas.set(email, senha);
  }
  return senhas;
}

function senhaDemo(email) {
  const senha = senhasDemo.get(email);
  if (!senha) falhar(`conta de demonstração sem senha no arquivo do seed:demo: ${email}`);
  return senha;
}

// ---- Banco ------------------------------------------------------------------------------

function lerEnvBackend() {
  const arquivo = join(BACKEND, '.env');
  const valores = {};
  if (!existsSync(arquivo)) return valores;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) valores[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return valores;
}

/** URL do banco descartável: a do backend/.env com outro nome. Recusa servidor não local. */
function montarUrlBanco() {
  if (!/^baluarte_carga[a-z0-9_]*$/.test(DB_NAME))
    falhar(`CARGA_DB_NAME precisa começar com baluarte_carga (recebi "${DB_NAME}")`);
  const base = env.DATABASE_URL ?? lerEnvBackend().DATABASE_URL;
  if (!base?.startsWith('postgres')) falhar('DATABASE_URL não encontrada (backend/.env)');
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    falhar(`o teste de carga só roda contra o Postgres local (DATABASE_URL aponta para ${url.hostname})`);
  url.pathname = `/${DB_NAME}`;
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  return url.toString();
}

const envBanco = () => ({
  ...env,
  DATABASE_URL: urlBanco,
  DIRECT_URL: urlBanco,
  ...(pastaSenhasDemo ? { SENHAS_DEMO_ARQUIVO: join(pastaSenhasDemo, 'senhas-demo.txt') } : {}),
});
const PRISMA = join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');

function rodar(nome, args) {
  log(`${nome}…`);
  const r = spawnSync(process.execPath, args, { cwd: BACKEND, env: envBanco(), stdio: 'inherit' });
  if (r.status !== 0) falhar(`${nome} falhou (código ${r.status})`);
}

function prepararBanco() {
  bancoCriado = true;
  rodar(`banco ${DB_NAME}: migrations do zero`, [PRISMA, 'migrate', 'reset', '--force', '--skip-seed']);
  rodar('seed de contrato', ['--import', 'tsx', 'prisma/seed.ts']);
  pastaSenhasDemo = mkdtempSync(join(tmpdir(), 'baluarte-carga-senhas-'));
  rodar('seed de demonstração', ['--import', 'tsx', 'prisma/seed-demo.ts']);
  senhasDemo = lerSenhasDemo(join(pastaSenhasDemo, 'senhas-demo.txt'));
  rodar('massa de carga', ['--import', 'tsx', 'prisma/seed-carga.ts']);
}

function apagarBanco() {
  if (!bancoCriado || env.CARGA_KEEP_DB === '1') return;
  const admin = new URL(urlBanco);
  admin.pathname = '/postgres';
  admin.searchParams.delete('schema');
  const r = spawnSync(process.execPath, [PRISMA, 'db', 'execute', '--url', admin.toString(), '--stdin'], {
    cwd: BACKEND,
    input: `DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE);`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  log(r.status === 0 ? `banco ${DB_NAME} apagado` : `não consegui apagar o banco ${DB_NAME} (apague à mão)`);
}

// ---- API ----------------------------------------------------------------------------------

function portaRespondendo(porta, host) {
  return new Promise((ok) => {
    const s = connect({ port: porta, host });
    s.setTimeout(1000);
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('timeout', () => (s.destroy(), ok(false)));
    s.once('error', () => ok(false));
  });
}

async function respondeHttp(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function iniciarApi() {
  mkdirSync(LOGS, { recursive: true });
  const arquivo = join(LOGS, 'api.log');
  const saida = createWriteStream(arquivo, { flags: 'w' });
  api = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: BACKEND,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...envBanco(),
      NODE_ENV: 'production',
      PORT: String(API_PORT),
      // DT28: em produção a API exige um domínio válido e recusa @empresa.com (o do backend/.env local).
      // A carga não cria campanha; o domínio reservado (RFC 2606) só cumpre a exigência.
      DOMINIO_INTERNO: '@baluarte.test',
      JWT_SECRET: randomBytes(32).toString('hex'),
      // Nada sai da máquina: sem e-mail, sem VirusTotal/OSV/NVD, sem ClamAV, sem agente.
      SMTP_HOST: '',
      BREVO_API_KEY: '',
      VIRUSTOTAL_API_KEY: '',
      VIRUSTOTAL_API_URL: 'http://127.0.0.1:9',
      OSV_API_URL: 'http://127.0.0.1:9',
      NVD_API_URL: 'http://127.0.0.1:9',
      NVD_API_KEY: '',
      CRUZAMENTO_AUTOMATICO: '0',
      CLAMAV_HOST: '',
      OSQUERY_ENROLL_SECRET: '',
    },
  });
  api.stdout.pipe(saida);
  api.stderr.pipe(saida);
  log(`API iniciada (pid ${api.pid}; log em ${arquivo})`);
  const fim = Date.now() + 60_000;
  while (Date.now() < fim) {
    if (api.exitCode !== null) falhar(`a API saiu (código ${api.exitCode}); veja ${arquivo}`);
    if (await respondeHttp(`${BASE}/health`)) return;
    await pausa(500);
  }
  falhar('a API não ficou pronta em 60 s');
}

async function pararApi() {
  if (!api || api.exitCode !== null) return;
  const saiu = new Promise((ok) => api.once('exit', ok));
  if (WIN) spawnSync('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
  else api.kill('SIGTERM');
  await Promise.race([saiu, pausa(5000)]);
  log('API parada');
}

// ---- Medição ------------------------------------------------------------------------------

async function entrar(email, senha) {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  const corpo = await r.json();
  if (r.status !== 200) falhar(`login de ${email} falhou (${r.status} ${corpo.codigoErro ?? ''})`);
  return corpo.dados.token;
}

function percentil(ordenados, p) {
  if (ordenados.length === 0) return null;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, i)];
}

/**
 * Roda um cenário no autocannon e devolve as medidas. A latência de cada resposta é guardada
 * (evento `response`) para calcular p50/p90/p95/p99 exatos; o autocannon não dá o p95.
 */
function medir({ conexoes, duracao, requisicao, metodo = 'GET', corpo, timeout = 30 }) {
  return new Promise((ok, erro) => {
    const latencias = []; // só das respostas 2xx
    let naoDoisCont = 0;
    const status = {};
    const instancia = autocannon(
      {
        url: BASE,
        connections: conexoes,
        duration: duracao,
        timeout,
        method: metodo,
        headers: corpo ? { 'content-type': 'application/json' } : {},
        requests: [{ method: metodo, setupRequest: requisicao }],
        ...(corpo ? { body: corpo } : {}),
      },
      (falha, r) => {
        if (falha) return erro(falha);
        // Percentis só das respostas 2xx: uma recusa rápida (429) nunca conta a favor da meta.
        latencias.sort((a, b) => a - b);
        const ok2xx = latencias.length;
        const total = ok2xx + naoDoisCont;
        ok({
          conexoes,
          duracaoS: duracao,
          requisicoes: total,
          rps: Number((total / duracao).toFixed(1)),
          p50: percentil(latencias, 50),
          p90: percentil(latencias, 90),
          p95: percentil(latencias, 95),
          p99: percentil(latencias, 99),
          max: ok2xx ? latencias[ok2xx - 1] : null,
          ok2xx,
          status,
          erros: r.errors,
          timeouts: r.timeouts,
          naoDois: naoDoisCont,
        });
      },
    );
    instancia.on('response', (_cliente, codigo, _bytes, tempo) => {
      if (codigo >= 200 && codigo < 300) latencias.push(tempo);
      else naoDoisCont++;
      status[codigo] = (status[codigo] ?? 0) + 1;
    });
  });
}

/** Uma requisição isolada (sem carga), no formato do `setupRequest`; devolve o tempo em ms. */
async function sozinha(requisicao, metodo = 'GET') {
  const req = requisicao({ method: metodo, headers: {} });
  const inicio = performance.now();
  const r = await fetch(`${BASE}${req.path}`, { method: req.method ?? metodo, headers: req.headers, body: req.body });
  await r.arrayBuffer();
  return performance.now() - inicio;
}

/**
 * Quando o autocannon termina, a API ainda processa o que ficou na fila (as conexões fecham, o
 * trabalho já aceito não). Espera a rota voltar ao tempo de quem está sozinho antes de seguir,
 * para um cenário não medir a sobra do anterior.
 */
async function esperarOcioso(requisicao, metodo, referenciaMs) {
  const limiar = Math.max(referenciaMs * 4, referenciaMs + 250);
  const fim = Date.now() + 120_000;
  while (Date.now() < fim) {
    if ((await sozinha(requisicao, metodo)) <= limiar) return;
    await pausa(500);
  }
  log('aviso: a API não voltou ao tempo de repouso em 120 s; o próximo cenário pode pegar sobra deste');
}

/**
 * Um cenário completo: aquecimento curto fora da medição (JIT e pool do Prisma), tempo de uma
 * requisição sozinha (mediana de 5, a referência "sem carga"), a medição e a espera pela fila.
 */
async function cenario({ conexoes, duracao, requisicao, metodo = 'GET', timeout }) {
  await medir({ conexoes: Math.min(10, conexoes), duracao: 3, requisicao, metodo });
  await esperarOcioso(requisicao, metodo, 1000);
  const amostras = [];
  for (let i = 0; i < 5; i++) amostras.push(await sozinha(requisicao, metodo));
  const semCarga = amostras.sort((a, b) => a - b)[2];
  const r = await medir({ conexoes, duracao, requisicao, metodo, timeout });
  await esperarOcioso(requisicao, metodo, semCarga);
  return { ...r, semCarga };
}

/** Rotaciona os tokens entre as requisições (vários usuários logados ao mesmo tempo). */
function comToken(tokens, caminho) {
  let i = 0;
  return (req) => ({
    ...req,
    path: typeof caminho === 'function' ? caminho(i) : caminho,
    headers: { ...req.headers, authorization: `Bearer ${tokens[i++ % tokens.length]}` },
  });
}

/**
 * Limite de tentativas: N senhas erradas SIMULTÂNEAS para o mesmo e-mail e depois a senha certa.
 * O limite é por e-mail (5 falhas em 15 min) e só conta falhas: login certo nunca bate nele.
 */
async function limiteDeLogin(email, senhaCerta, tentativas) {
  const tentar = (senha) =>
    fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    }).then(async (r) => ({ status: r.status, codigo: (await r.json()).codigoErro }));
  const inicio = performance.now();
  const respostas = await Promise.all(Array.from({ length: tentativas }, () => tentar('Errada@123')));
  const duracaoMs = Math.round(performance.now() - inicio);
  const contagem = {};
  for (const { status } of respostas) contagem[status] = (contagem[status] ?? 0) + 1;
  const depois = await tentar(senhaCerta);
  return { email, tentativas, duracaoMs, contagem, senhaCertaDepois: depois };
}

/**
 * Vaga única de exportação (DT36): N pedidos do PDF ao MESMO tempo. Esperado: exatamente um 200
 * (o PDF) e os outros 429 EXPORTACAO_EM_ANDAMENTO. Sai do cenário de carga do PDF (que agora tem
 * 1 conexão) para a regra continuar verificada.
 */
async function exportacoesSimultaneas(token, pedidos) {
  const pedir = async () => {
    const r = await fetch(`${BASE}/api/vulnerabilidades/relatorio.pdf`, { headers: { authorization: `Bearer ${token}` } });
    const corpo = Buffer.from(await r.arrayBuffer());
    const pdf = corpo.subarray(0, 5).toString('latin1') === '%PDF-';
    let codigo = null;
    if (!pdf) {
      try {
        codigo = JSON.parse(corpo.toString('utf8')).codigoErro ?? null;
      } catch {
        codigo = 'corpo não JSON';
      }
    }
    return { status: r.status, pdf, codigo };
  };
  const respostas = await Promise.all(Array.from({ length: pedidos }, pedir));
  const pdfs = respostas.filter((r) => r.status === 200 && r.pdf).length;
  const recusas = respostas.filter((r) => r.status === 429 && r.codigo === 'EXPORTACAO_EM_ANDAMENTO').length;
  return { pedidos, pdfs, recusas, respostas, atende: pdfs === 1 && recusas === pedidos - 1 };
}

function textoExportacoes(e) {
  const outras = e.respostas.length - e.pdfs - e.recusas;
  const sobra = outras ? ` e ${outras} outra(s) resposta(s): ${JSON.stringify(e.respostas)}` : '';
  return `${e.pedidos} pedidos do PDF disparados ao mesmo tempo: ${e.pdfs} × 200 com PDF e ${e.recusas} × 429 \`EXPORTACAO_EM_ANDAMENTO\`${sobra}. Esperado (DT36, vaga única): exatamente 1 PDF e ${e.pedidos - 1} recusas. **${e.atende ? 'Atende' : 'Não atende'}.**`;
}

// ---- Relatório ----------------------------------------------------------------------------

const ms = (v) => (v === null ? '—' : `${Math.round(v).toLocaleString('pt-BR')} ms`);
const num = (v) => v.toLocaleString('pt-BR');

function ambiente() {
  const cpu = cpus();
  const pg = spawnSync('docker', ['ps', '--filter', 'publish=5432', '--format', '{{.Image}}'], { encoding: 'utf8' });
  return {
    data: new Date().toISOString(),
    so: `${tipoSo()} ${release()}`,
    cpu: `${cpu[0]?.model?.trim()} (${cpu.length} núcleos lógicos)`,
    memoriaGiB: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    postgres: pg.status === 0 && pg.stdout.trim() ? pg.stdout.trim().split('\n')[0] : 'Postgres local',
    autocannon: JSON.parse(readFileSync(join(BACKEND, 'node_modules', 'autocannon', 'package.json'), 'utf8')).version,
  };
}

/** Atende só com a métrica dentro da meta E sem nenhuma resposta fora de 2xx (nem erro de conexão). */
function veredito(valor, meta, c = {}) {
  if (meta === null) return 'informativo';
  if ((c.naoDois ?? 0) > 0 || (c.erros ?? 0) > 0 || (c.timeouts ?? 0) > 0) return 'não atende';
  return valor !== null && valor <= meta ? 'atende' : 'não atende';
}

/** Antes × depois por cenário, se houver uma rodada de referência gravada (ver ANTES). */
function comparacao(antes, cenarios) {
  if (!antes) return '';
  const linhas = cenarios
    .map((c) => [c, antes.cenarios.find((a) => a.id === c.id)])
    .filter(([, a]) => a)
    .map(
      ([c, a]) =>
        `| ${c.titulo} | ${a.rps.toLocaleString('pt-BR')} → ${c.rps.toLocaleString('pt-BR')} | ${ms(a.p50)} → ${ms(c.p50)} | ${ms(a.p90)} → ${ms(c.p90)} | ${ms(a.p99)} → ${ms(c.p99)} |`,
    );
  return `
### Antes e depois das correções do dashboard (B30)

A rodada de referência, sobre o código da \`main\` sem o B30 (\`4f6faf7\`, já com a evolução de 30 dias do B25b; mesmo script e mesma massa, em ${antes.ambiente.data}), reprova o dashboard. Três causas, corrigidas no B30 com o mesmo resultado: (1) \`GET /dashboard\` trazia **todos** os achados do banco (com ativo e remediação) a cada leitura e agregava em memória; agora conta por severidade e críticos no banco e traz só os 5 mais recentes (\`panoramaAbertos\`); (2) a evolução de 30 dias buscava o último evento de cada achado em cada dia (~30 × achados buscas no índice, e o custo estimado ainda ligava o JIT do Postgres a cada leitura); agora lê o histórico como trechos de status, numa passada (\`abertosPorDia\`); (3) a janela de 30 dias montava dezenas de \`Intl.DateTimeFormat\` por leitura, na mesma thread da API; agora um por fuso (\`evolucaoRisco.service.ts\`). As duas consultas ficam em \`backend/src/repositories/vulnerabilidade.repository.ts\`; \`backend/tests/dashboard.test.ts\` confere as duas contra a regra antiga e passa também no código anterior. A rodada de referência fica em \`testes/carga/resultados-antes-b30.json\`.

| Cenário | Req/s | p50 | p90 | p99 |
|---|---:|---:|---:|---:|
${linhas.join('\n')}
`;
}

function gerarRelatorio({ amb, cenarios, exportacoes, limite, massa, antes }) {
  const linhas = cenarios.map(
    (c) =>
      `| ${c.titulo} | ${ms(c.semCarga)} | ${c.conexoes} | ${num(c.requisicoes)} | ${c.rps.toLocaleString('pt-BR')} | ${ms(c.p50)} | ${ms(c.p90)} | ${ms(c.p95)} | ${ms(c.p99)} | ${ms(c.max)} | ${num(c.naoDois)} | ${num(c.erros)} / ${num(c.timeouts)} | ${c.metaTexto} | **${veredito(c[c.metrica], c.meta, c)}** |`,
  );
  const contagem = Object.entries(limite.contagem)
    .map(([s, n]) => `${n} × ${s}`)
    .join(', ');
  return `# Teste de carga da API — RNF-004 (B30)

Gerado por \`npm run carga\` (\`backend/scripts/carga.mjs\`) em ${amb.data}. **Não edite à mão:** rode de novo.

## O que o RNF-004 pede

DRS v4: "Relatórios de varredura em até 60s para até 50 endpoints. Dashboard em até 3s para até 200 usuários simultâneos." Critério: **P90 do dashboard ≤ 3 s** com 200 usuários e **relatório ≤ 60 s em 95% das execuções**. A US-003 (cenário 3) pede ainda que **cada página** da lista de vulnerabilidades carregue em até 3 s.

## Como foi medido

- **Instância isolada:** banco descartável \`${DB_NAME}\` no Postgres local (migrations + \`seed\` + \`seed:demo\` + \`seed:carga\`: ${massa}), API em \`:${API_PORT}\` com \`NODE_ENV=production\`, um processo Node. Nada de produção (Vercel/Supabase), da \`8080\` ou do banco \`baluarte\`. No fim, a API é parada e o banco apagado.
- **Ferramenta:** autocannon ${amb.autocannon} (versão fixa em \`backend/package.json\`). Cada cenário dura ${DURACAO} s depois de 3 s de aquecimento fora da medição; a latência de **cada** resposta 2xx é registrada para calcular p50/p90/p95/p99 (as fora de 2xx são contadas à parte e reprovam o cenário). "Sozinha" é a mediana de 5 requisições em sequência, sem carga. Entre um cenário e outro, o script espera a API esvaziar a fila (a rota voltar ao tempo de repouso), para um cenário não medir a sobra do anterior. "200 usuários simultâneos" = 200 conexões HTTP mantendo uma requisição em voo o tempo todo, sem pausa entre elas (mais duro que 200 pessoas, que leem a tela entre um clique e outro).
- **O que entra no tempo:** a resposta da API, que é a parte que cresce com a carga. A tela soma o JavaScript e o CSS, servidos pelo Nginx (Docker) ou pela CDN (Vercel) sem passar pela API: o dashboard faz uma requisição só à API (\`GET /api/dashboard\`).
- **Sessões:** os tokens de Administrador, Analista e de um segundo Analista se revezam entre as requisições (o dashboard desses perfis é o mais pesado: o do Colaborador não calcula os indicadores técnicos).
- **Máquina:** ${amb.cpu}, ${amb.memoriaGiB} GiB, ${amb.so}, Node ${amb.node}, banco ${amb.postgres}. Gerador de carga, API e banco dividem a mesma máquina, então os números são conservadores para a API e não valem como medida da demo pública.

## Resultados

| Cenário | Sozinha | Conexões | Requisições | Req/s | p50 | p90 | p95 | p99 | máx. | não 2xx | erros / timeouts | Meta | Resultado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
${linhas.join('\n')}
${comparacao(antes, cenarios)}
### Exportações simultâneas do relatório (vaga única, DT36)

${textoExportacoes(exportacoes)} Por isso o cenário de carga do PDF usa 1 conexão: até 24/11/2026 ele usava 10, e 98% das respostas eram esse 429 rápido, contado no p95 como se fosse PDF pronto (falso verde). Agora os percentis são só das respostas 2xx, e qualquer resposta fora de 2xx num cenário com meta reprova.

### Limite de tentativas de login

O limite é **por e-mail** (5 falhas em 15 min, tabela \`LoginFailure\`) e conta só falhas: login com a senha certa nunca bate nele. O cenário de login acima reveza ${num(limite.contasLogin)} contas válidas da massa de demonstração e recebeu ${num(limite.status429NoLogin)} respostas 429. Para exercitar o limite, ${limite.tentativas} tentativas com senha errada foram disparadas **ao mesmo tempo** para \`${limite.email}\` (${limite.duracaoMs} ms ao todo): ${contagem}. Logo depois, a senha **certa** recebeu \`${limite.senhaCertaDepois.status} ${limite.senhaCertaDepois.codigo ?? ''}\`.

${limite.notas}

## Leitura

${cenarios.map((c) => `- **${c.titulo}:** ${c.leitura}`).join('\n')}

## Como repetir

\`\`\`bash
docker compose up -d db          # só o Postgres local (se ainda não estiver no ar)
cd backend && npm run carga      # ~${Math.ceil((cenarios.length * (DURACAO + 3) + 60) / 60)} min: prepara o banco, mede, escreve este arquivo e limpa tudo
\`\`\`

Variáveis: \`CARGA_CONEXOES\` (${CONEXOES}), \`CARGA_DURACAO\` (${DURACAO} s por cenário), \`CARGA_CONEXOES_LOGIN\` (${CONEXOES_LOGIN}), \`CARGA_API_PORT\` (${API_PORT}), \`CARGA_DB_NAME\` (\`${DB_NAME}\`, precisa começar com \`baluarte_carga\`), \`CARGA_KEEP_DB=1\` (mantém o banco). Os números brutos ficam em \`testes/carga/resultados.json\`; o log da API em \`%TEMP%/baluarte-carga/api.log\`.
`;
}

// ---- Fluxo --------------------------------------------------------------------------------

async function principal() {
  if (PORTAS_PROIBIDAS.has(API_PORT)) falhar(`a porta ${API_PORT} é da stack de desenvolvimento; escolha outra`);
  if ((await portaRespondendo(API_PORT, '127.0.0.1')) || (await portaRespondendo(API_PORT, '::1')))
    falhar(`a porta ${API_PORT} já está em uso`);
  urlBanco = montarUrlBanco();
  prepararBanco();
  await iniciarApi();
  log(`API em ${BASE} (NODE_ENV=production)`);
  if (MODO === 'ambiente') return esperarInterrupcao();
  if (MODO === 'jmeter') return rodarJmeter();

  const tokens = [];
  for (const [email, senha] of CONTAS_TOKEN) tokens.push(await entrar(email, senha ?? senhaDemo(email)));
  const resumo = await (
    await fetch(`${BASE}/api/vulnerabilidades?tamanho=1`, { headers: { authorization: `Bearer ${tokens[0]}` } })
  ).json();
  const totalAchados = resumo.resumo.total;
  const paginas = Math.ceil(totalAchados / 20);
  const ativos = (await (await fetch(`${BASE}/api/assets`, { headers: { authorization: `Bearer ${tokens[0]}` } })).json()).dados
    .length;
  const massa = `${num(totalAchados)} achados em ${ativos} ativos`;
  log(`massa: ${massa}`);

  const definicoes = [
    {
      id: 'dashboard',
      titulo: 'Dashboard (`GET /api/dashboard`)',
      caminho: '/api/dashboard',
      meta: 3000,
      metrica: 'p90',
      metaTexto: 'p90 ≤ 3 s (RNF-004)',
    },
    {
      id: 'vulnerabilidades',
      titulo: `Vulnerabilidades paginadas (\`GET /api/vulnerabilidades?pagina=1..${paginas}&tamanho=20\`)`,
      caminho: (i) => `/api/vulnerabilidades?pagina=${(i % paginas) + 1}&tamanho=20`,
      meta: 3000,
      metrica: 'p90',
      metaTexto: 'p90 ≤ 3 s (US-003 / RNF-004)',
    },
    {
      id: 'ativos',
      titulo: 'Ativos com nota de risco (`GET /api/assets`)',
      caminho: '/api/assets',
      meta: 3000,
      metrica: 'p90',
      metaTexto: 'p90 ≤ 3 s (mesma régua do dashboard)',
    },
  ];

  const cenarios = [];
  for (const d of definicoes) {
    log(`cenário: ${d.titulo} (${CONEXOES} conexões, ${DURACAO} s)`);
    const { caminho, ...resto } = d;
    cenarios.push({ ...resto, ...(await cenario({ conexoes: CONEXOES, duracao: DURACAO, requisicao: comToken(tokens, caminho) })) });
  }

  // PDF com todos os achados: é o "relatório" do RNF-004 (≤ 60 s em 95% das execuções). Poucas
  // conexões: gerar o PDF é ação pontual de quem opera, não de 200 pessoas ao mesmo tempo.
  const conexoesPdf = CONEXOES_PDF;
  log(`cenário: relatório em PDF (${conexoesPdf} conexões, ${DURACAO} s)`);
  cenarios.push({
    id: 'pdf',
    titulo: `Relatório de vulnerabilidades em PDF, ${num(totalAchados)} achados (\`GET /api/vulnerabilidades/relatorio.pdf\`)`,
    meta: 60_000,
    metrica: 'p95',
    metaTexto: 'p95 ≤ 60 s (RNF-004)',
    ...(await cenario({
      conexoes: conexoesPdf,
      duracao: DURACAO,
      requisicao: comToken(tokens, '/api/vulnerabilidades/relatorio.pdf'),
      timeout: 90,
    })),
  });

  log(`vaga única de exportação: ${EXPORTACOES_SIMULTANEAS} pedidos simultâneos do PDF`);
  const exportacoes = await exportacoesSimultaneas(tokens[0], EXPORTACOES_SIMULTANEAS);

  // Login com senha certa, revezando as contas da massa de demonstração (cada uma com a sua senha,
  // lida do arquivo gerado pelo seed:demo; DT32).
  const contas = CONTAS_LOGIN;
  let n = 0;
  const login = (req) => ({
    ...req,
    path: '/api/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: (() => {
      const email = contas[n++ % contas.length];
      return JSON.stringify({ email, senha: senhaDemo(email) });
    })(),
  });
  log(`cenário: login (${CONEXOES_LOGIN} conexões, ${DURACAO} s)`);
  cenarios.push({
    id: 'login',
    titulo: 'Login com senha certa (`POST /api/login`, bcrypt custo 10)',
    meta: null,
    metrica: 'p90',
    metaTexto: 'sem meta no DRS',
    ...(await cenario({ conexoes: CONEXOES_LOGIN, duracao: DURACAO, requisicao: login, metodo: 'POST' })),
  });

  log('limite de tentativas de login');
  const limite = await limiteDeLogin(EMAIL_LIMITE, senhaDemo(EMAIL_LIMITE), TENTATIVAS_LIMITE);
  limite.contasLogin = contas.length;
  limite.status429NoLogin = cenarios.at(-1).status[429] ?? 0;

  for (const c of cenarios) c.leitura = lerCenario(c);
  limite.notas = lerLimite(limite);

  const amb = ambiente();
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(join(SAIDA, 'resultados.json'), `${JSON.stringify({ ambiente: amb, massa, cenarios, exportacoes, limite }, null, 2)}\n`);
  const antes = existsSync(ANTES) ? JSON.parse(readFileSync(ANTES, 'utf8')) : null;
  writeFileSync(join(SAIDA, 'RELATORIO.md'), gerarRelatorio({ amb, cenarios, exportacoes, limite, massa, antes }));
  log(`relatório em ${join(SAIDA, 'RELATORIO.md')}`);
  for (const c of cenarios)
    log(`${c.titulo}: ${c.requisicoes} req, p50 ${ms(c.p50)}, p90 ${ms(c.p90)}, p95 ${ms(c.p95)}, p99 ${ms(c.p99)}, não 2xx ${c.naoDois}, erros ${c.erros}`);
  log(`limite: ${JSON.stringify(limite.contagem)}; senha certa depois → ${limite.senhaCertaDepois.status}`);

  log(`exportações simultâneas: ${exportacoes.pdfs} PDF, ${exportacoes.recusas} × 429 EXPORTACAO_EM_ANDAMENTO (${exportacoes.atende ? 'atende' : 'NÃO atende'})`);

  const reprovado = !exportacoes.atende || cenarios.some((c) => c.meta !== null && veredito(c[c.metrica], c.meta, c) !== 'atende');
  return reprovado ? 1 : 0;
}

// ---- Modos JMeter e ambiente --------------------------------------------------------------

const PASTA_JMETER = join(SAIDA, 'jmeter');
const PLANO_JMETER = join(PASTA_JMETER, 'baluarte-carga.jmx');

/**
 * Arquivos TSV (email<TAB>senha) que o plano do JMeter lê: contas do token, contas do login e a
 * conta do limite. Ficam no temporário das senhas do seed:demo (fora do repositório), que é
 * apagado no fim, como o resto (DT32). Devolve as propriedades -J do plano.
 */
function propriedadesJmeter() {
  const tsv = (nome, contas) => {
    const arquivo = join(pastaSenhasDemo, nome);
    writeFileSync(arquivo, contas.map(([email, senha]) => `${email}\t${senha ?? senhaDemo(email)}`).join('\n') + '\n');
    return arquivo;
  };
  return {
    porta: API_PORT,
    conexoes: CONEXOES,
    duracao: DURACAO,
    conexoesLogin: CONEXOES_LOGIN,
    conexoesPdf: CONEXOES_PDF,
    tentativasLimite: TENTATIVAS_LIMITE,
    exportacoesSimultaneas: EXPORTACOES_SIMULTANEAS,
    contasToken: tsv('contas-token.tsv', CONTAS_TOKEN),
    contasLogin: tsv('contas-login.tsv', CONTAS_LOGIN.map((e) => [e, null])),
    contaLimite: tsv('conta-limite.tsv', [[EMAIL_LIMITE, null]]),
  };
}

/** `--ambiente`: banco e API no ar até Ctrl+C, para rodar o .jmx à mão (interface do JMeter). */
async function esperarInterrupcao() {
  const props = propriedadesJmeter();
  log('ambiente pronto; Ctrl+C para parar a API e apagar o banco');
  log(`abra ${PLANO_JMETER} no JMeter com estas propriedades (os arquivos somem no fim):`);
  log(Object.entries(props).map(([k, v]) => `-J${k}=${v}`).join(' '));
  return new Promise(() => {});
}

function executavelJmeter() {
  const home = env.JMETER_HOME;
  if (!home) falhar('defina JMETER_HOME com a pasta do Apache JMeter 5.6.3 (ex.: C:\\ferramentas\\apache-jmeter-5.6.3)');
  const bin = join(home, 'bin', WIN ? 'jmeter.bat' : 'jmeter');
  if (!existsSync(bin)) falhar(`não achei ${bin}`);
  return bin;
}

/** Lê o .jtl em CSV (o JMeter põe entre aspas os campos com vírgula). */
function lerJtl(arquivo) {
  const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(Boolean);
  const campos = (linha) => {
    const saida = [];
    let atual = '';
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (aspas) {
        if (ch === '"' && linha[i + 1] === '"') (atual += '"'), i++;
        else if (ch === '"') aspas = false;
        else atual += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === ',') saida.push(atual), (atual = '');
      else atual += ch;
    }
    saida.push(atual);
    return saida;
  };
  const cabecalho = campos(linhas[0]);
  return linhas.slice(1).map((l) => Object.fromEntries(campos(l).map((v, i) => [cabecalho[i], v])));
}

// Cenários medidos (o rótulo do sampler no .jmx começa com o prefixo); aquecimento e preparação
// ficam fora, como no autocannon.
const CENARIOS_JMETER = [
  { id: 'dashboard', prefixo: 'Dashboard - ', titulo: 'Dashboard (`GET /api/dashboard`)', meta: 3000, metrica: 'p90', metaTexto: 'p90 ≤ 3 s (RNF-004)' },
  { id: 'vulnerabilidades', prefixo: 'Vulnerabilidades - ', titulo: 'Vulnerabilidades paginadas (`GET /api/vulnerabilidades?pagina=…&tamanho=20`)', meta: 3000, metrica: 'p90', metaTexto: 'p90 ≤ 3 s (US-003 / RNF-004)' },
  { id: 'ativos', prefixo: 'Ativos - ', titulo: 'Ativos com nota de risco (`GET /api/assets`)', meta: 3000, metrica: 'p90', metaTexto: 'p90 ≤ 3 s (mesma régua do dashboard)' },
  { id: 'pdf', prefixo: 'PDF - ', titulo: 'Relatório de vulnerabilidades em PDF (`GET /api/vulnerabilidades/relatorio.pdf`)', meta: 60_000, metrica: 'p95', metaTexto: 'p95 ≤ 60 s (RNF-004)' },
  { id: 'login', prefixo: 'Login - ', titulo: 'Login com senha certa (`POST /api/login`, bcrypt custo 10)', meta: null, metrica: 'p90', metaTexto: 'sem meta no DRS' },
];

function resumirJtl(amostras) {
  const cenarios = CENARIOS_JMETER.map((d) => {
    const doCenario = amostras.filter((a) => a.label.startsWith(d.prefixo));
    // Percentis só das respostas 2xx (as outras reprovam o cenário à parte, ver veredito).
    const latencias = doCenario
      .filter((a) => a.responseCode.startsWith('2'))
      .map((a) => Number(a.elapsed))
      .sort((x, y) => x - y);
    const status = {};
    for (const a of doCenario) status[a.responseCode] = (status[a.responseCode] ?? 0) + 1;
    const inicio = Math.min(...doCenario.map((a) => Number(a.timeStamp)));
    const fim = Math.max(...doCenario.map((a) => Number(a.timeStamp) + Number(a.elapsed)));
    const duracaoS = doCenario.length ? (fim - inicio) / 1000 : 0;
    const total = doCenario.length;
    const ok2xx = latencias.length;
    const naoHttp = doCenario.filter((a) => !/^\d{3}$/.test(a.responseCode)).length;
    const naoDois = doCenario.filter((a) => !a.responseCode.startsWith('2')).length;
    const reprovadasPorTempo = doCenario.filter((a) => /lasted too long/.test(a.failureMessage ?? '')).length;
    return {
      ...d,
      conexoes: Number(doCenario[0]?.grpThreads ?? 0),
      requisicoes: total,
      duracaoS: Number(duracaoS.toFixed(1)),
      rps: duracaoS ? Number((total / duracaoS).toFixed(1)) : 0,
      p50: percentil(latencias, 50),
      p90: percentil(latencias, 90),
      p95: percentil(latencias, 95),
      p99: percentil(latencias, 99),
      max: ok2xx ? latencias[ok2xx - 1] : null,
      ok2xx,
      status,
      naoDois,
      erros: naoHttp,
      acimaDoTempo: reprovadasPorTempo,
    };
  });
  // Vaga única (DT36): o plano marca como sucesso só 200 com %PDF- ou 429 com EXPORTACAO_EM_ANDAMENTO.
  const exp = amostras.filter((a) => a.label.startsWith('Exportação simultânea - '));
  const expPdfs = exp.filter((a) => a.responseCode === '200' && a.success === 'true').length;
  const expRecusas = exp.filter((a) => a.responseCode === '429' && a.success === 'true').length;
  const exportacoes = {
    pedidos: exp.length,
    pdfs: expPdfs,
    recusas: expRecusas,
    respostas: exp.map((a) => ({ status: a.responseCode, ok: a.success === 'true', falha: a.failureMessage || undefined })),
    atende: exp.length === EXPORTACOES_SIMULTANEAS && expPdfs === 1 && expRecusas === exp.length - 1,
  };
  const errada = amostras.filter((a) => a.label.startsWith('Limite - ') && a.label.includes('senha errada'));
  const certa = amostras.find((a) => a.label.startsWith('Limite - ') && a.label.includes('senha certa'));
  const contagem = {};
  for (const a of errada) contagem[a.responseCode] = (contagem[a.responseCode] ?? 0) + 1;
  const inicio = Math.min(...errada.map((a) => Number(a.timeStamp)));
  const fim = Math.max(...errada.map((a) => Number(a.timeStamp) + Number(a.elapsed)));
  const limite = {
    email: EMAIL_LIMITE,
    tentativas: errada.length,
    duracaoMs: errada.length ? fim - inicio : null,
    contagem,
    senhaCertaDepois: { status: Number(certa?.responseCode) || certa?.responseCode || null },
  };
  return { cenarios, exportacoes, limite };
}

function relatorioJmeter({ amb, cenarios, exportacoes, limite, versaoJmeter, duracaoTotalS }) {
  const linhas = cenarios.map(
    (c) =>
      `| ${c.titulo} | ${c.conexoes} | ${num(c.requisicoes)} | ${c.rps.toLocaleString('pt-BR')} | ${ms(c.p50)} | ${ms(c.p90)} | ${ms(c.p95)} | ${ms(c.p99)} | ${ms(c.max)} | ${num(c.naoDois)} | ${num(c.erros)} | ${c.meta === null ? '—' : num(c.acimaDoTempo)} | ${c.metaTexto} | **${veredito(c[c.metrica], c.meta, c)}** |`,
  );
  const contagem = Object.entries(limite.contagem).map(([s, n]) => `${n} × ${s}`).join(', ');
  const avaliadas = limite.contagem[401] ?? 0;
  return `# Teste de carga da API no Apache JMeter — RNF-004

Gerado por \`npm run carga:jmeter\` (\`backend/scripts/carga.mjs --jmeter\`) em ${amb.data}. **Não edite à mão:** rode de novo.

## O que foi rodado

- **Ferramenta:** Apache JMeter ${versaoJmeter}, modo sem interface (\`jmeter -n -t baluarte-carga.jmx -l resultados.jtl -e -o relatorio-html\`), Java da máquina (${amb.java}).
- **Plano:** [\`baluarte-carga.jmx\`](baluarte-carga.jmx). Um grupo de preparação faz **login real** de três contas (Administrador, Analista e um segundo Analista), **extrai o token** da resposta (\`JSON Extractor\` em \`$.dados.token\`) e o guarda numa propriedade; os grupos de carga mandam \`Authorization: Bearer <token>\` revezando as três sessões. O número de páginas da lista também é extraído da resposta (\`$.resumo.total\`). Os grupos rodam em sequência, cada cenário depois de 3 s de aquecimento fora da medição.
- **Cenários:** dashboard, vulnerabilidades paginadas (todas as páginas em rodízio) e ativos com **${CONEXOES} usuários simultâneos** cada (${DURACAO} s, sem pausa entre requisições: cada usuário virtual mantém uma requisição em voo o tempo todo); PDF do relatório com ${CONEXOES_PDF} usuário (vaga única, DT36) e ${EXPORTACOES_SIMULTANEAS} pedidos simultâneos do PDF para conferir essa vaga; login com senha certa com ${CONEXOES_LOGIN}; e ${TENTATIVAS_LIMITE} senhas erradas **simultâneas** (Synchronizing Timer) para o mesmo e-mail, seguidas da senha certa.
- **Asserções:** status 200 em todos os cenários; resposta do PDF começando com \`%PDF-\`; tempo por resposta (Duration Assertion) de 3 s no dashboard e na lista e de 60 s no PDF. A meta do RNF-004 é sobre o **percentil**, não sobre cada resposta: a coluna "acima do tempo" conta as respostas isoladas que passaram do limite, e o veredito usa o percentil.
- **Ambiente:** o mesmo do \`npm run carga\`: banco descartável \`${DB_NAME}\` no Postgres local (migrations + \`seed\` + \`seed:demo\` + \`seed:carga\`), API em \`127.0.0.1:${API_PORT}\` com \`NODE_ENV=production\`, um processo Node; no fim, a API é parada e o banco apagado. O host do plano é fixo em \`127.0.0.1\`: nada de VM, Vercel ou Supabase.
- **Máquina:** ${amb.cpu}, ${amb.memoriaGiB} GiB, ${amb.so}, Node ${amb.node}, banco ${amb.postgres}. JMeter, API e banco dividem a mesma máquina (o JMeter, em Java, disputa CPU com a API): os números são conservadores para a API e não valem como medida da demonstração pública.
- **Duração total do plano:** ${duracaoTotalS} s.
- **Limitação:** o JMeter 5.6.3 traz o Groovy 3.0.20, que não roda no Java 25 ("Unsupported class file major version 69"). Por isso o plano não tem nenhum script (JSR223): só elementos nativos e as funções \`__P\`, \`__setProperty\`, \`__jexl3\`, \`__counter\`, \`__threadNum\` e \`__logn\`.

## Resultados

Percentis calculados aqui sobre **todas as respostas 2xx** do \`resultados.jtl\`, pelo mesmo método do \`npm run carga\` (posto mais próximo); as respostas fora de 2xx são contadas à parte e reprovam o cenário, para uma recusa rápida (429) nunca contar a favor da meta. O relatório HTML do JMeter (\`relatorio-html/index.html\`) mostra as mesmas amostras com o estimador dele (interpolado), e pode diferir em poucos milissegundos.

| Cenário | Usuários | Requisições | Req/s | p50 | p90 | p95 | p99 | máx. | não 2xx | erros de conexão | acima do tempo | Meta | Resultado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
${linhas.join('\n')}

### Exportações simultâneas do relatório (vaga única, DT36)

${textoExportacoes(exportacoes)} No plano, ${EXPORTACOES_SIMULTANEAS} usuários virtuais pedem o PDF juntos (Synchronizing Timer) e a asserção só aceita 200 com corpo \`%PDF-\` ou 429 com \`EXPORTACAO_EM_ANDAMENTO\`. É por essa regra que o cenário de carga do PDF tem ${CONEXOES_PDF} usuário: com vários, quase todas as respostas seriam o 429 rápido.

### Limite de tentativas de login

${limite.tentativas} senhas erradas disparadas ao mesmo tempo para \`${limite.email}\` (${limite.duracaoMs} ms ao todo): ${contagem}. ${avaliadas <= 5 ? `O limite segura a rajada: no máximo 5 avaliadas pela política (5 falhas em 15 min, reserva da vaga antes do bcrypt, DT09).` : `**Mais de 5 senhas avaliadas: o limite não segurou a rajada.**`} Logo depois, a senha **certa** recebeu \`${limite.senhaCertaDepois.status}\`${limite.senhaCertaDepois.status === 429 ? ' (esperado: com o e-mail bloqueado, nem a senha certa entra até a janela passar)' : ' (esperado era 429: confira a política)'}.

## Arquivos

- [\`baluarte-carga.jmx\`](baluarte-carga.jmx): o plano (abre na interface do JMeter);
- [\`relatorio-html/index.html\`](relatorio-html/index.html): relatório do JMeter (aquecimento e preparação filtrados por \`relatorio.properties\`);
- \`resultados.jtl\`: todas as amostras, em CSV (fora do git, ~9 MB; refeito a cada rodada);
- [\`resultados.json\`](resultados.json): os números desta tabela.

## Como repetir

\`\`\`bash
docker compose up -d db                                      # só o Postgres local
cd backend
JMETER_HOME=/caminho/apache-jmeter-5.6.3 npm run carga:jmeter  # prepara, mede, gera o relatório e limpa tudo
\`\`\`

Para abrir o plano na interface do JMeter com o ambiente no ar: \`npm run carga:ambiente\` (mostra as propriedades \`-J\` a passar; Ctrl+C derruba tudo).
`;
}

async function rodarJmeter() {
  const bin = executavelJmeter();
  const props = propriedadesJmeter();
  const jtl = join(PASTA_JMETER, 'resultados.jtl');
  const html = join(PASTA_JMETER, 'relatorio-html');
  const args = [
    '-n', '-t', PLANO_JMETER, '-l', jtl, '-e', '-o', html, '-f',
    '-q', join(PASTA_JMETER, 'relatorio.properties'),
    '-j', join(LOGS, 'jmeter.log'),
    ...Object.entries(props).map(([k, v]) => `-J${k}=${v}`),
  ];
  log(`JMeter: ${bin} (log em ${join(LOGS, 'jmeter.log')})`);
  const inicio = Date.now();
  const filho = WIN
    ? spawn('cmd.exe', ['/d', '/c', bin, ...args], { cwd: PASTA_JMETER, stdio: 'inherit', env: { ...env, JVM_ARGS: env.JVM_ARGS ?? '-Xms1g -Xmx2g' } })
    : spawn(bin, args, { cwd: PASTA_JMETER, stdio: 'inherit', env: { ...env, JVM_ARGS: env.JVM_ARGS ?? '-Xms1g -Xmx2g' } });
  const codigo = await new Promise((ok) => filho.once('exit', ok));
  const duracaoTotalS = Math.round((Date.now() - inicio) / 1000);
  if (codigo !== 0) falhar(`o JMeter saiu com código ${codigo}`);
  if (!existsSync(jtl)) falhar('o JMeter não gravou o resultados.jtl');

  const { cenarios, exportacoes, limite } = resumirJtl(lerJtl(jtl));
  if (cenarios.some((c) => c.requisicoes === 0)) falhar(`cenário sem amostras: ${cenarios.filter((c) => !c.requisicoes).map((c) => c.id).join(', ')}`);
  const versaoJmeter = basenameVersao(env.JMETER_HOME);
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const amb = { ...ambiente(), java: (java.stderr || java.stdout || '').split('\n')[0].trim() || 'java' };
  writeFileSync(join(PASTA_JMETER, 'resultados.json'), `${JSON.stringify({ ambiente: amb, jmeter: versaoJmeter, duracaoTotalS, cenarios, exportacoes, limite }, null, 2)}\n`);
  writeFileSync(join(PASTA_JMETER, 'RELATORIO.md'), relatorioJmeter({ amb, cenarios, exportacoes, limite, versaoJmeter, duracaoTotalS }));
  log(`relatório em ${join(PASTA_JMETER, 'RELATORIO.md')} e ${join(html, 'index.html')}`);
  for (const c of cenarios)
    log(`${c.titulo}: ${c.requisicoes} req, p50 ${ms(c.p50)}, p90 ${ms(c.p90)}, p95 ${ms(c.p95)}, p99 ${ms(c.p99)}, não 2xx ${c.naoDois}, erros ${c.erros}`);
  log(`limite: ${JSON.stringify(limite.contagem)}; senha certa depois → ${limite.senhaCertaDepois.status}`);
  log(`exportações simultâneas: ${exportacoes.pdfs} PDF, ${exportacoes.recusas} × 429 (${exportacoes.atende ? "atende" : "NÃO atende"})`);
  return !exportacoes.atende || cenarios.some((c) => c.meta !== null && veredito(c[c.metrica], c.meta, c) !== "atende") ? 1 : 0;
}

const basenameVersao = (pasta) => (pasta.match(/(\d+\.\d+(?:\.\d+)?)/) ?? [])[1] ?? 'desconhecida';

function lerCenario(c) {
  const sem = c.naoDois === 0 && c.erros === 0 && c.timeouts === 0 ? 'sem nenhuma resposta fora de 2xx' : `com ${num(c.naoDois)} respostas fora de 2xx, ${num(c.erros)} erros e ${num(c.timeouts)} timeouts`;
  const base = `${num(c.requisicoes)} requisições em ${c.duracaoS} s (${c.rps.toLocaleString('pt-BR')}/s), ${sem}; ${c.metrica} de ${ms(c[c.metrica])}`;
  if (c.meta === null)
    return `${base}. O bcrypt (custo 10, \`bcryptjs\` em JavaScript puro) gasta CPU de propósito e roda na mesma thread da API: o login é a rota mais cara (cerca de ${ms(c.semCarga)} sozinho, ~${Math.round(c.rps)} por segundo no máximo), e uma rajada de logins atrasa as outras rotas enquanto dura. O DRS não dá meta para o login; com ${c.conexoes} logins simultâneos a resposta passa de 3 s.`;
  const folga = c[c.metrica] !== null ? (c.meta / c[c.metrica]).toFixed(1).replace('.', ',') : '—';
  const resultado =
    veredito(c[c.metrica], c.meta, c) === 'atende'
      ? `Atende com folga de ${folga}× sobre a meta.`
      : c.naoDois > 0 || c.erros > 0 || c.timeouts > 0
        ? 'Não atende: houve respostas fora de 2xx (o percentil é só das respostas 2xx, e uma recusa nunca conta a favor da meta).'
        : 'Fica acima da meta nesta máquina.';
  if (c.id === 'pdf')
    return `${base}. ${resultado} O PDF é o relatório com todos os achados do filtro, gerado em memória; a varredura simulada conclui em 20 s por construção (\`cicloVarredura.service.ts\`), então o relatório de uma varredura nova fica pronto em cerca de 20 s mais este tempo. Medido com ${c.conexoes} conexão: desde o DT36 a exportação tem vaga única (uma por vez; a regra é conferida no item "Exportações simultâneas").`;
  return `${base}. ${resultado}`;
}

function lerLimite(l) {
  const aceitas = l.contagem[401] ?? 0;
  const bloqueadas = l.contagem[429] ?? 0;
  const linhas = [];
  if (aceitas > 5)
    linhas.push(
      `**Achado (segurança):** das ${l.tentativas} senhas erradas simultâneas, ${aceitas} foram avaliadas (401) e ${bloqueadas} recusadas com 429, acima das 5 da política. A checagem (\`contarFalhasLogin\`) acontece antes do bcrypt e o registro da falha depois dele, sem nada que os torne atômicos: requisições paralelas passam todas pela contagem antes de qualquer uma gravar. Numa rajada, o número de senhas testadas só é limitado pelo paralelismo do atacante; o bloqueio vale para as tentativas seguintes. Correção sugerida: reservar a tentativa antes do bcrypt (gravar e contar incluindo a própria) ou serializar por e-mail com \`pg_advisory_xact_lock\`, com teste de rajada em \`tests/seguranca/\`. Fica como pendência, fora do escopo do B30.`,
    );
  else
    linhas.push(
      `O limite segura a rajada: ${aceitas} senhas erradas avaliadas (401) e ${bloqueadas} recusadas com 429, sem chegar ao bcrypt. A primeira rodada do B30 mostrou 20 × 401 (a contagem vinha antes do bcrypt e o registro da falha depois, sem atomicidade); o DT09 corrigiu reservando a vaga por e-mail antes do bcrypt (\`repositories/auth.repository.ts#reservar\`, teste em \`tests/seguranca/limite-rajada.test.ts\`).`,
    );
  linhas.push(
    l.senhaCertaDepois.status === 429
      ? 'Com o e-mail bloqueado, nem a senha certa entra até a janela de 15 min passar (comportamento esperado da política).'
      : `A senha certa depois do bloqueio recebeu ${l.senhaCertaDepois.status}: confira a política.`,
  );
  return linhas.join(' ');
}

let encerrando = false;
async function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  try {
    await pararApi();
    if (urlBanco) apagarBanco();
    if (pastaSenhasDemo) rmSync(pastaSenhasDemo, { recursive: true, force: true });
  } finally {
    process.exit(codigo);
  }
}
process.on('SIGINT', () => void encerrar(130));
process.on('SIGTERM', () => void encerrar(143));

principal()
  .then((codigo) => encerrar(codigo))
  .catch((e) => {
    console.error(`[carga] ${e instanceof Error ? e.message : e}`);
    void encerrar(1);
  });
