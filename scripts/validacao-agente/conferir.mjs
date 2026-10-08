// Conferencia da validacao do agente (B08, scripts/validar-agente-docker.sh). Roda num
// conteiner da mesma rede, fala com a API PELO HTTPS do servico app (Nginx do B06), confiando
// so na CA local gerada para a validacao (NODE_EXTRA_CA_CERTS), como o navegador e o agente.
// Confere: inscricao, inventario (programas, SO, portas), estacao em GET /estacoes, novo
// ciclo sem duplicar, e a verificacao do B14 contra as bases SIMULADAS. Sai com 1 se algo falhar.
import assert from 'node:assert/strict';

const API = process.env.API ?? 'https://app/api';
const BASES = process.env.BASES ?? 'http://bases-simuladas:8090';
// Conta do seed de contrato (senha publica do README; existe so no banco descartavel).
const EMAIL = process.env.CONFERENCIA_EMAIL ?? 'analista@empresa.com';
const SENHA = process.env.CONFERENCIA_SENHA ?? 'Senha@123';
const LIMITE_S = Number(process.env.LIMITE_S ?? 240);

const t0 = Date.now();
const decorrido = () => `${Math.round((Date.now() - t0) / 1000)}s`;
const log = (...a) => console.log(`[conferencia +${decorrido()}]`, ...a);
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
let token = '';

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* corpo nao JSON */
  }
  return { status: r.status, json, texto };
}

async function esperar(descricao, fn) {
  for (;;) {
    const v = await fn().catch((e) => {
      if (process.env.DEBUG) console.error(e);
      return null;
    });
    if (v) return v;
    if (Date.now() - t0 > LIMITE_S * 1000) throw new Error(`tempo esgotado esperando: ${descricao}`);
    await dormir(3000);
  }
}

// 1. Login pelo HTTPS (prova a cadeia CA -> certificado do app e o proxy /api).
await esperar('login pelo HTTPS do app', async () => {
  const r = await chamar('POST', '/login', { email: EMAIL, senha: SENHA });
  if (r.status !== 200) return null;
  token = r.json.dados.token;
  return true;
});
log(`login OK pelo HTTPS (${API}), certificado validado pela CA local`);

// 2. A estacao se inscreve e aparece no painel.
const estacao = await esperar('estação inscrita em GET /estacoes', async () => {
  const r = await chamar('GET', '/estacoes');
  return r.status === 200 && r.json.dados.length > 0 ? r.json.dados[0] : null;
});
log(`estação inscrita: nome=${estacao.nome} host=${estacao.host} identificador=${estacao.identificador}`);

// 3. O inventario chega (programas, SO e portas) no primeiro ciclo.
const det1 = await esperar('inventário com programas e portas', async () => {
  const r = await chamar('GET', `/estacoes/${estacao.id}`);
  const d = r.json?.dados;
  return r.status === 200 && d.totalProgramas > 0 && d.totalPortas > 0 ? d : null;
});
const libc = det1.programas.find((p) => p.nome === 'libc6');
log(`inventário recebido: sistema="${det1.sistema}" plataforma=${det1.soPlataforma} status=${det1.status}`);
log(`  programas=${det1.totalProgramas} (ex.: libc6 ${libc?.versao}, fonte ${libc?.fonte}) portas=${det1.totalPortas}: ${det1.portas.map((p) => `${p.porta}/${p.protocolo} ${p.processo ?? '?'}`).join(', ')}`);
log(`  inscritaEm=${det1.inscritaEm} inventarioEm=${det1.inventarioEm} ultimoContato=${det1.ultimoContato}`);
assert.equal(det1.status, 'Online');
assert.ok(libc, 'libc6 deveria estar no inventário do Ubuntu');
assert.equal(det1.soPlataforma, 'ubuntu');

// 4. Proximo ciclo: o inventario e substituido, nunca somado.
const det2 = await esperar('segundo ciclo de inventário', async () => {
  const r = await chamar('GET', `/estacoes/${estacao.id}`);
  const d = r.json?.dados;
  return r.status === 200 && d.inventarioEm !== det1.inventarioEm && d.totalPortas > 0 ? d : null;
});
const chaves = det2.programas.map((p) => `${p.fonte}|${p.nome}|${p.versao}`);
assert.equal(new Set(chaves).size, chaves.length, 'programa repetido no inventário');
assert.equal(det2.totalProgramas, det1.totalProgramas, 'o total de programas mudou entre ciclos iguais');
const lista = await chamar('GET', '/estacoes');
assert.equal(lista.json.resumo.total, 1, 'a estação foi duplicada');
log(`segundo ciclo (inventarioEm=${det2.inventarioEm}): programas=${det2.totalProgramas} portas=${det2.totalPortas}, sem duplicar; estações no painel=${lista.json.resumo.total}`);

// 5. B14: verificacao contra as bases SIMULADAS (a API nao tem saida para a internet).
const v1 = await chamar('POST', `/estacoes/${estacao.id}/verificar`);
assert.equal(v1.status, 200, v1.texto);
log(`B14 verificar #1: ${JSON.stringify(v1.json.dados)}`);
assert.ok(v1.json.dados.achadosNovos >= 1, 'a vulnerabilidade simulada deveria virar achado');
const v2 = await chamar('POST', `/estacoes/${estacao.id}/verificar`);
assert.equal(v2.status, 200, v2.texto);
log(`B14 verificar #2: achadosNovos=${v2.json.dados.achadosNovos} achadosExistentes=${v2.json.dados.achadosExistentes} (não duplica)`);
assert.equal(v2.json.dados.achadosNovos, 0);
const achados = await chamar('GET', '/vulnerabilidades?q=CVE-2099-0001');
const a = achados.json.dados[0];
assert.equal(achados.json.resumo.total, 1);
log(`achado: ${a.cve} programa=${a.programa} ${a.programaVersao} cvss=${a.cvss} severidade=${a.severidade} base=${a.baseVulnerabilidade}`);
const pedidos = await (await fetch(`${BASES}/_pedidos`)).json();
log(`bases simuladas receberam: ${JSON.stringify(pedidos)}`);

const final = (await chamar('GET', `/estacoes/${estacao.id}`)).json.dados;
log(`estação no fim: status=${final.status} totalAchados=${final.totalAchados} achadosAbertos=${final.achadosAbertos} verificadaEm=${final.verificadaEm}`);
log('VALIDAÇÃO OK');
