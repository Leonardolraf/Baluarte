// Metrica S1 do Plano de Qualidade v2: inventario das rotas protegidas (lido do proprio roteador
// da API, apiRouter.stack) x respostas registradas durante a execucao da suite (s1-preload.mjs).
// Uma rota conta como "com teste" quando, nos testes, ela respondeu 401 a um pedido SEM token e,
// se for restrita por perfil, 403 PERFIL_SEM_PERMISSAO a um pedido COM token de perfil nao permitido.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BACK = process.env.S1_BACKEND;
const SAIDA = process.env.S1_SAIDA;
const { apiRouter } = await import(pathToFileURL(join(BACK, 'src/routes/index.ts')).href);
const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
const OPERADORES = ['Administrador', 'Analista'];
const ASPA = String.fromCharCode(39);

const linhasRotas = readdirSync(join(BACK, 'src/routes'))
  .filter((f) => f.endsWith('.routes.ts'))
  .flatMap((f) => readFileSync(join(BACK, 'src/routes', f), 'utf8').split('\n'));

function perfisDe(metodo, caminho) {
  const alvo = 'r.' + metodo.toLowerCase() + '(' + ASPA + caminho + ASPA;
  const linha = linhasRotas.find((l) => l.includes(alvo));
  if (!linha) return null;
  const i = linha.indexOf('exigePerfil(');
  if (i < 0) return PERFIS;
  const arg = linha.slice(i + 'exigePerfil('.length, linha.indexOf(')', i)).trim();
  if (arg === '...OPERADORES') return OPERADORES;
  return arg.split(',').map((p) => p.trim().split(ASPA).join('')).filter(Boolean);
}

const rotas = [];
for (const camada of apiRouter.stack) {
  if (!camada.route) continue;
  const nomes = camada.route.stack.map((l) => l.name);
  const protegida = nomes.includes('exigeToken') || nomes.includes('exigeSessao');
  for (const metodo of Object.keys(camada.route.methods)) {
    const caminho = camada.route.path;
    const perfis = perfisDe(metodo, caminho);
    rotas.push({
      chave: metodo.toUpperCase() + ' /api' + caminho,
      protegida,
      perfis,
      restrita: perfis ? perfis.length < PERFIS.length : null,
    });
  }
}

const registros = [];
for (const f of readdirSync(SAIDA)) {
  for (const l of readFileSync(join(SAIDA, f), 'utf8').split('\n')) if (l) registros.push(JSON.parse(l));
}
const porRota = new Map();
for (const x of registros) {
  const k = x.m + ' ' + x.r;
  if (!porRota.has(k)) porRota.set(k, []);
  porRota.get(k).push(x);
}

const protegidas = rotas
  .filter((r) => r.protegida)
  .map((r) => {
    const rs = porRota.get(r.chave) ?? [];
    const t401 = rs.some((x) => x.s === 401 && !x.t);
    const t403 = rs.some((x) => x.s === 403 && x.t && x.c === 'PERFIL_SEM_PERMISSAO');
    return { ...r, chamadas: rs.length, t401, t403, ok: t401 && (r.restrita ? t403 : true) };
  });

const n = protegidas.length;
const completas = protegidas.filter((l) => l.ok).length;
const restritas = protegidas.filter((l) => l.restrita);
const resumo = {
  registros: registros.length,
  rotasApi: rotas.length,
  protegidas: n,
  publicas: rotas.length - n,
  restritasPorPerfil: restritas.length,
  com401SemToken: protegidas.filter((l) => l.t401).length,
  restritasCom403: restritas.filter((l) => l.t403).length,
  completas,
  percentual: n ? Number(((100 * completas) / n).toFixed(1)) : null,
  perfilNaoLido: protegidas.filter((l) => !l.perfis).map((l) => l.chave),
};
console.log(JSON.stringify(resumo, null, 1));
console.log('\nFALTANDO (rota | perfis | chamadas nos testes | 401 sem token | 403 de perfil):');
for (const l of protegidas.filter((x) => !x.ok)) {
  console.log([l.chave, (l.perfis ?? ['?']).join('/'), l.chamadas, l.t401, l.restrita ? l.t403 : 'n/a'].join(' | '));
}
