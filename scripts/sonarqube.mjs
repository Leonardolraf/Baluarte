#!/usr/bin/env node
// Análise estática com SonarQube Community, local e temporária (B30, RNF-008). Sobe, analisa,
// escreve o resultado e derruba tudo:
//   1. rede Docker própria e SonarQube Community em versão fixa (só em 127.0.0.1:9000);
//   2. senha do admin trocada por uma aleatória e token de análise gerados NA HORA, só na memória
//      deste processo: nunca vão para arquivo, log ou repositório (o contêiner morre no fim);
//   3. sonar-scanner (contêiner oficial, versão fixa) no backend e no frontend, cada um com o
//      seu `sonar-project.properties` e o lcov da cobertura já gerado;
//   4. quality gate, bugs, vulnerabilidades, code smells, hotspots, duplicação, cobertura e as
//      issues de severidade alta/bloqueadora em testes/qualidade/sonarqube.md (+ sonarqube.json);
//   5. remove os contêineres, os volumes anônimos e a rede.
//
// Antes, gere a cobertura em lcov (o script recusa rodar sem ela):
//   cd backend && TEST_DB_PREFIXO=sonar_ npm run cobertura    # Postgres local no ar
//   cd baluarte-frontend && npm run test:coverage
// Uso: node scripts/sonarqube.mjs   (SONAR_PORTA troca a porta local, padrão 9000)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'testes', 'qualidade');
const IMAGEM_SONAR = 'sonarqube:26.8.0.126808-community';
const IMAGEM_SCANNER = 'sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0';
const REDE = 'baluarte-sonar';
const CONTEINER = 'baluarte-sonarqube';
const PORTA = Number(process.env.SONAR_PORTA ?? 9000);
const URL_LOCAL = `http://127.0.0.1:${PORTA}`;
const PROJETOS = [
  { pasta: 'backend', chave: 'baluarte-backend', nome: 'Backend (Express + Prisma)', lcov: 'coverage/lcov.info' },
  { pasta: 'baluarte-frontend', chave: 'baluarte-frontend', nome: 'Frontend do produto (React + Vite)', lcov: 'coverage/lcov.info' },
];
const METRICAS = [
  'alert_status',
  'bugs',
  'vulnerabilities',
  'security_hotspots',
  'code_smells',
  'coverage',
  'line_coverage',
  'branch_coverage',
  'duplicated_lines_density',
  'ncloc',
  'reliability_rating',
  'security_rating',
  'sqale_rating',
  'security_review_rating',
];

const log = (msg) => console.log(`[sonarqube] ${msg}`);
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const falhar = (msg) => {
  throw new Error(msg);
};

function docker(args, { silencioso = false } = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!silencioso && r.status !== 0) falhar(`docker ${args.slice(0, 2).join(' ')} falhou: ${r.stderr.trim()}`);
  return r;
}

let senhaAdmin = 'admin';
let token = '';

/** Chamada à API do SonarQube com o admin (antes do token) ou com o token de análise. */
async function api(caminho, { metodo = 'GET', corpo, comToken = false } = {}) {
  const credencial = comToken ? `${token}:` : `admin:${senhaAdmin}`;
  // Uma nova tentativa em falha de rede: depois de minutos parado no scanner, a conexão
  // reaproveitada pelo fetch pode ter sido fechada pelo servidor.
  const pedir = () => fetch(`${URL_LOCAL}${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Basic ${Buffer.from(credencial).toString('base64')}`,
      ...(corpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: corpo ? new URLSearchParams(corpo).toString() : undefined,
  });
  let r;
  try {
    r = await pedir();
  } catch {
    await pausa(2000);
    r = await pedir();
  }
  const texto = await r.text();
  if (!r.ok) falhar(`${metodo} ${caminho.split('?')[0]} → ${r.status}`);
  return texto ? JSON.parse(texto) : {};
}

async function esperarNoAr() {
  const fim = Date.now() + 5 * 60_000;
  while (Date.now() < fim) {
    try {
      const r = await fetch(`${URL_LOCAL}/api/system/status`);
      if (r.ok && (await r.json()).status === 'UP') return;
    } catch {
      // ainda subindo
    }
    await pausa(3000);
  }
  falhar('o SonarQube não ficou no ar em 5 min');
}

function subir() {
  if (docker(['ps', '-a', '--filter', `name=^${CONTEINER}$`, '--format', '{{.Names}}']).stdout.trim())
    falhar(`já existe um contêiner ${CONTEINER}; remova-o (docker rm -f -v ${CONTEINER})`);
  docker(['network', 'create', REDE]);
  log(`subindo ${IMAGEM_SONAR} em ${URL_LOCAL} (só local)`);
  docker([
    'run', '-d', '--name', CONTEINER, '--network', REDE, '--network-alias', 'sonarqube',
    '-p', `127.0.0.1:${PORTA}:9000`,
    // Instância de uso único: sem as checagens de produção do Elasticsearch (vm.max_map_count).
    '-e', 'SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true',
    '-e', 'SONAR_TELEMETRY_ENABLE=false',
    IMAGEM_SONAR,
  ]);
}

function derrubar() {
  docker(['rm', '-f', '-v', CONTEINER], { silencioso: true });
  docker(['network', 'rm', REDE], { silencioso: true });
  log('contêiner, volumes anônimos e rede removidos');
}

/** Troca a senha padrão por uma aleatória e gera o token de análise (só em memória). */
async function credenciais() {
  const nova = `B30-${randomBytes(18).toString('base64url')}`;
  await api('/api/users/change_password', {
    metodo: 'POST',
    corpo: { login: 'admin', previousPassword: 'admin', password: nova },
  });
  senhaAdmin = nova;
  const r = await api('/api/user_tokens/generate', {
    metodo: 'POST',
    corpo: { name: `b30-${Date.now()}`, type: 'GLOBAL_ANALYSIS_TOKEN' },
  });
  token = r.token;
}

/**
 * O lcov do c8 (backend) traz caminhos absolutos da máquina; o scanner roda num contêiner Linux
 * com o projeto em /usr/src. Reescreve para caminhos relativos numa cópia (o original fica).
 */
function lcovRelativo(projeto) {
  const pasta = join(RAIZ, projeto.pasta);
  const original = join(pasta, projeto.lcov);
  if (!existsSync(original))
    falhar(`sem ${projeto.pasta}/${projeto.lcov}: gere a cobertura antes (veja o topo deste script)`);
  const prefixos = [pasta, pasta.replace(/\\/g, '/')].map((p) => (p.endsWith('/') || p.endsWith('\\') ? p : `${p}${p.includes('\\') ? '\\' : '/'}`));
  const linhas = readFileSync(original, 'utf8')
    .split(/\r?\n/)
    .map((l) => {
      if (!l.startsWith('SF:')) return l;
      let caminho = l.slice(3);
      for (const p of prefixos) if (caminho.toLowerCase().startsWith(p.toLowerCase())) caminho = caminho.slice(p.length);
      return `SF:${caminho.replace(/\\/g, '/')}`;
    });
  const destino = join(dirname(original), 'lcov-sonar.info');
  writeFileSync(destino, linhas.join('\n'));
  return `${dirname(projeto.lcov)}/lcov-sonar.info`.replace(/\\/g, '/');
}

async function analisar(projeto) {
  const lcov = lcovRelativo(projeto);
  log(`analisando ${projeto.pasta} (${IMAGEM_SCANNER})`);
  await api('/api/projects/create', { metodo: 'POST', corpo: { project: projeto.chave, name: projeto.nome } });
  const r = spawnSync(
    'docker',
    [
      'run', '--rm', '--network', REDE,
      '-e', 'SONAR_HOST_URL=http://sonarqube:9000',
      '-e', 'SONAR_TOKEN', // valor herdado do ambiente deste processo, não vai na linha de comando
      '-v', `${join(RAIZ, projeto.pasta)}:/usr/src`,
      IMAGEM_SCANNER,
      `-Dsonar.javascript.lcov.reportPaths=${lcov}`,
      '-Dsonar.scm.disabled=true',
    ],
    { encoding: 'utf8', env: { ...process.env, SONAR_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const saida = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) falhar(`o scanner falhou em ${projeto.pasta}:\n${saida.split('\n').slice(-30).join('\n')}`);
  const tarefa = saida.match(/api\/ce\/task\?id=([\w-]+)/)?.[1];
  if (!tarefa) falhar(`não achei a tarefa de processamento do ${projeto.pasta}`);
  const avisos = saida.split('\n').filter((l) => /WARN/.test(l) && /lcov|resolve|coverage/i.test(l));
  return { tarefa, avisos };
}

async function esperarTarefa(id) {
  const fim = Date.now() + 10 * 60_000;
  while (Date.now() < fim) {
    const { task } = await api(`/api/ce/task?id=${id}`);
    if (task.status === 'SUCCESS') return;
    if (['FAILED', 'CANCELED'].includes(task.status)) falhar(`processamento ${task.status}: ${task.errorMessage ?? ''}`);
    await pausa(2000);
  }
  falhar('o processamento da análise não terminou em 10 min');
}

async function coletar(projeto) {
  const chave = encodeURIComponent(projeto.chave);
  const portao = (await api(`/api/qualitygates/project_status?projectKey=${chave}`)).projectStatus;
  const medidas = Object.fromEntries(
    (await api(`/api/measures/component?component=${chave}&metricKeys=${METRICAS.join(',')}`)).component.measures.map(
      (m) => [m.metric, m.value],
    ),
  );
  const facetas = await api(
    `/api/issues/search?componentKeys=${chave}&resolved=false&ps=1&facets=severities,impactSeverities,impactSoftwareQualities,types`,
  );
  const faceta = (nome) => Object.fromEntries((facetas.facets.find((f) => f.property === nome)?.values ?? []).map((v) => [v.val, v.count]));
  const graves = await api(
    `/api/issues/search?componentKeys=${chave}&resolved=false&ps=100&impactSeverities=BLOCKER,HIGH&s=SEVERITY&asc=false`,
  );
  const criticas = await api(
    `/api/issues/search?componentKeys=${chave}&resolved=false&ps=100&severities=BLOCKER,CRITICAL`,
  );
  // Todo bug e vulnerabilidade (tipos clássicos) e tudo o que toca segurança (modelo de impactos),
  // de qualquer severidade: é o que precisa de triagem um a um no relatório.
  const bugsEVulns = await api(`/api/issues/search?componentKeys=${chave}&resolved=false&ps=100&types=BUG,VULNERABILITY`);
  const seguranca = await api(`/api/issues/search?componentKeys=${chave}&resolved=false&ps=100&impactSoftwareQualities=SECURITY`);
  const hotspots = await api(`/api/hotspots/search?project=${chave}&ps=100&status=TO_REVIEW`);
  const issue = (i) => ({
    regra: i.rule,
    arquivo: i.component.replace(`${projeto.chave}:`, ''),
    linha: i.line ?? null,
    mensagem: i.message,
    severidade: i.severity,
    impactos: (i.impacts ?? []).map((x) => `${x.softwareQuality}:${x.severity}`).join(', '),
    tipo: i.type,
  });
  return {
    ...projeto,
    portao: { status: portao.status, condicoes: portao.conditions ?? [] },
    medidas,
    total: facetas.total ?? facetas.paging?.total ?? 0,
    porSeveridade: faceta('severities'),
    porImpacto: faceta('impactSeverities'),
    porQualidade: faceta('impactSoftwareQualities'),
    porTipo: faceta('types'),
    graves: graves.issues.map(issue),
    criticas: criticas.issues.map(issue),
    bugsEVulnerabilidades: bugsEVulns.issues.map(issue),
    seguranca: seguranca.issues.map(issue),
    hotspots: hotspots.hotspots.map((h) => ({
      regra: h.ruleKey,
      arquivo: h.component.replace(`${projeto.chave}:`, ''),
      linha: h.line ?? null,
      mensagem: h.message,
      probabilidade: h.vulnerabilityProbability,
      categoria: h.securityCategory,
    })),
  };
}

async function principal() {
  for (const p of PROJETOS) lcovRelativo(p); // falha cedo se faltar cobertura
  for (const img of [IMAGEM_SONAR, IMAGEM_SCANNER]) {
    log(`baixando ${img} (se ainda não estiver na máquina)`);
    docker(['pull', '-q', img]);
  }
  subir();
  await esperarNoAr();
  await credenciais();
  const versao = await (await fetch(`${URL_LOCAL}/api/server/version`)).text();
  const resultados = [];
  for (const p of PROJETOS) {
    const { tarefa, avisos } = await analisar(p);
    await esperarTarefa(tarefa);
    resultados.push({ ...(await coletar(p)), avisosScanner: avisos });
  }
  mkdirSync(SAIDA, { recursive: true });
  const dados = { data: new Date().toISOString(), sonarqube: versao, imagens: { sonarqube: IMAGEM_SONAR, scanner: IMAGEM_SCANNER }, projetos: resultados };
  writeFileSync(join(SAIDA, 'sonarqube.json'), `${JSON.stringify(dados, null, 2)}\n`);
  for (const r of resultados)
    log(
      `${r.pasta}: portão ${r.portao.status}, bugs ${r.medidas.bugs}, vulnerabilidades ${r.medidas.vulnerabilities}, code smells ${r.medidas.code_smells}, hotspots ${r.medidas.security_hotspots}, duplicação ${r.medidas.duplicated_lines_density}%, cobertura ${r.medidas.coverage}%, BLOCKER/HIGH ${r.graves.length}, BLOCKER/CRITICAL ${r.criticas.length}`,
    );
  log(`dados brutos em ${join(SAIDA, 'sonarqube.json')} (o relatório sonarqube.md é escrito a partir deles)`);
}

let encerrando = false;
async function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  token = '';
  senhaAdmin = '';
  derrubar();
  process.exit(codigo);
}
process.on('SIGINT', () => void encerrar(130));
process.on('SIGTERM', () => void encerrar(143));

principal()
  .then(() => encerrar(0))
  .catch((e) => {
    const causa = e instanceof Error && e.cause ? ` (${e.cause.code ?? e.cause.message ?? e.cause})` : '';
    console.error(`[sonarqube] ${e instanceof Error ? e.message : e}${causa}`);
    // Para diagnosticar: as últimas linhas do servidor antes de removê-lo.
    const logs = docker(['logs', '--tail', '40', CONTEINER], { silencioso: true });
    if (logs.status === 0) console.error(`${logs.stdout}${logs.stderr}`);
    void encerrar(1);
  });
