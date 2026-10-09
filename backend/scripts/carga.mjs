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
// Variáveis (padrões entre parênteses): CARGA_DB_NAME (baluarte_carga, precisa começar assim)
//   CARGA_API_PORT (8100)  CARGA_CONEXOES (200)  CARGA_DURACAO (30, em segundos, por cenário)
//   CARGA_CONEXOES_LOGIN (50)  CARGA_KEEP_DB=1 mantém o banco no fim (para investigar).
import autocannon from 'autocannon';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const log = (msg) => console.log(`[carga] ${msg}`);
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const falhar = (msg) => {
  throw new Error(msg);
};

let api = null;
let urlBanco = '';
let bancoCriado = false;

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

const envBanco = () => ({ ...env, DATABASE_URL: urlBanco, DIRECT_URL: urlBanco });
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
  rodar('seed de demonstração', ['--import', 'tsx', 'prisma/seed-demo.ts']);
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
    const latencias = [];
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
        latencias.sort((a, b) => a - b);
        const total = latencias.length;
        const ok2xx = Object.entries(status)
          .filter(([codigo]) => codigo.startsWith('2'))
          .reduce((s, [, n]) => s + n, 0);
        ok({
          conexoes,
          duracaoS: duracao,
          requisicoes: total,
          rps: Number((total / duracao).toFixed(1)),
          p50: percentil(latencias, 50),
          p90: percentil(latencias, 90),
          p95: percentil(latencias, 95),
          p99: percentil(latencias, 99),
          max: total ? latencias[total - 1] : null,
          status,
          erros: r.errors,
          timeouts: r.timeouts,
          naoDois: total - ok2xx,
        });
      },
    );
    instancia.on('response', (_cliente, codigo, _bytes, tempo) => {
      latencias.push(tempo);
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

function veredito(valor, meta) {
  if (meta === null) return 'informativo';
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

function gerarRelatorio({ amb, cenarios, limite, massa, antes }) {
  const linhas = cenarios.map(
    (c) =>
      `| ${c.titulo} | ${ms(c.semCarga)} | ${c.conexoes} | ${num(c.requisicoes)} | ${c.rps.toLocaleString('pt-BR')} | ${ms(c.p50)} | ${ms(c.p90)} | ${ms(c.p95)} | ${ms(c.p99)} | ${ms(c.max)} | ${num(c.naoDois)} | ${num(c.erros)} / ${num(c.timeouts)} | ${c.metaTexto} | **${veredito(c[c.metrica], c.meta)}** |`,
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
- **Ferramenta:** autocannon ${amb.autocannon} (versão fixa em \`backend/package.json\`). Cada cenário dura ${DURACAO} s depois de 3 s de aquecimento fora da medição; a latência de **cada** resposta é registrada para calcular p50/p90/p95/p99. "Sozinha" é a mediana de 5 requisições em sequência, sem carga. Entre um cenário e outro, o script espera a API esvaziar a fila (a rota voltar ao tempo de repouso), para um cenário não medir a sobra do anterior. "200 usuários simultâneos" = 200 conexões HTTP mantendo uma requisição em voo o tempo todo, sem pausa entre elas (mais duro que 200 pessoas, que leem a tela entre um clique e outro).
- **O que entra no tempo:** a resposta da API, que é a parte que cresce com a carga. A tela soma o JavaScript e o CSS, servidos pelo Nginx (Docker) ou pela CDN (Vercel) sem passar pela API: o dashboard faz uma requisição só à API (\`GET /api/dashboard\`).
- **Sessões:** os tokens de Administrador, Analista e de um segundo Analista se revezam entre as requisições (o dashboard desses perfis é o mais pesado: o do Colaborador não calcula os indicadores técnicos).
- **Máquina:** ${amb.cpu}, ${amb.memoriaGiB} GiB, ${amb.so}, Node ${amb.node}, banco ${amb.postgres}. Gerador de carga, API e banco dividem a mesma máquina, então os números são conservadores para a API e não valem como medida da demo pública.

## Resultados

| Cenário | Sozinha | Conexões | Requisições | Req/s | p50 | p90 | p95 | p99 | máx. | não 2xx | erros / timeouts | Meta | Resultado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
${linhas.join('\n')}
${comparacao(antes, cenarios)}
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

  const tokens = [
    await entrar('admin@empresa.com', 'Admin@123'),
    await entrar('analista@empresa.com', 'Senha@123'),
    await entrar('edson@empresa.com', 'Mudar@123'),
  ];
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
  const conexoesPdf = 10;
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

  // Login com senha certa, revezando as contas da massa de demonstração (senha Mudar@123).
  const contas = ['edson@empresa.com', 'ana.souza@empresa.com', 'bruno.lima@empresa.com'].concat(
    Array.from({ length: 203 }, (_, i) => `colab${i}@empresa.com`),
  );
  let n = 0;
  const login = (req) => ({
    ...req,
    path: '/api/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: contas[n++ % contas.length], senha: 'Mudar@123' }),
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
  const limite = await limiteDeLogin('ana.souza@empresa.com', 'Mudar@123', 20);
  limite.contasLogin = contas.length;
  limite.status429NoLogin = cenarios.at(-1).status[429] ?? 0;

  for (const c of cenarios) c.leitura = lerCenario(c);
  limite.notas = lerLimite(limite);

  const amb = ambiente();
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(join(SAIDA, 'resultados.json'), `${JSON.stringify({ ambiente: amb, massa, cenarios, limite }, null, 2)}\n`);
  const antes = existsSync(ANTES) ? JSON.parse(readFileSync(ANTES, 'utf8')) : null;
  writeFileSync(join(SAIDA, 'RELATORIO.md'), gerarRelatorio({ amb, cenarios, limite, massa, antes }));
  log(`relatório em ${join(SAIDA, 'RELATORIO.md')}`);
  for (const c of cenarios)
    log(`${c.titulo}: ${c.requisicoes} req, p50 ${ms(c.p50)}, p90 ${ms(c.p90)}, p95 ${ms(c.p95)}, p99 ${ms(c.p99)}, não 2xx ${c.naoDois}, erros ${c.erros}`);
  log(`limite: ${JSON.stringify(limite.contagem)}; senha certa depois → ${limite.senhaCertaDepois.status}`);

  const reprovado = cenarios.some((c) => c.meta !== null && veredito(c[c.metrica], c.meta) !== 'atende');
  return reprovado ? 1 : 0;
}

function lerCenario(c) {
  const sem = c.naoDois === 0 && c.erros === 0 && c.timeouts === 0 ? 'sem nenhuma resposta fora de 2xx' : `com ${num(c.naoDois)} respostas fora de 2xx, ${num(c.erros)} erros e ${num(c.timeouts)} timeouts`;
  const base = `${num(c.requisicoes)} requisições em ${c.duracaoS} s (${c.rps.toLocaleString('pt-BR')}/s), ${sem}; ${c.metrica} de ${ms(c[c.metrica])}`;
  if (c.meta === null)
    return `${base}. O bcrypt (custo 10, \`bcryptjs\` em JavaScript puro) gasta CPU de propósito e roda na mesma thread da API: o login é a rota mais cara (cerca de ${ms(c.semCarga)} sozinho, ~${Math.round(c.rps)} por segundo no máximo), e uma rajada de logins atrasa as outras rotas enquanto dura. O DRS não dá meta para o login; com ${c.conexoes} logins simultâneos a resposta passa de 3 s.`;
  const folga = c[c.metrica] !== null ? (c.meta / c[c.metrica]).toFixed(1).replace('.', ',') : '—';
  const resultado = veredito(c[c.metrica], c.meta) === 'atende' ? `Atende com folga de ${folga}× sobre a meta.` : 'Fica acima da meta nesta máquina.';
  if (c.id === 'pdf')
    return `${base}. ${resultado} O PDF é o relatório com todos os achados do filtro, gerado em memória; a varredura simulada conclui em 20 s por construção (\`cicloVarredura.service.ts\`), então o relatório de uma varredura nova fica pronto em cerca de 20 s mais este tempo. Medido com ${c.conexoes} conexões: exportar o PDF é ação de quem opera, não de 200 pessoas ao mesmo tempo.`;
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
