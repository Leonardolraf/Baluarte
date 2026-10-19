// Pentest automatizado — DIMENSAO limites sob rajada paralela, analise de arquivos (DT09).
// O mesmo defeito do login: `verificarAntesDeReceber` contava as analises da ultima hora (20 por
// usuario) e os anexos do destinatario na campanha (5 por evento) ANTES de passar o arquivo pelo
// antivirus, e o FileScan so era gravado DEPOIS do veredito. N envios simultaneos liam a mesma
// contagem e passavam todos. Os testes sequenciais (analise-arquivo.test.ts e
// anexo-campanha.test.ts) semeiam o FileScan e passam mesmo com o defeito; aqui as requisicoes
// saem juntas (Promise.all) e o clamd falso demora a responder, para todas chegarem ao limite
// antes de qualquer veredito. Confere-se o teto (respostas, registros e pedidos ao antivirus),
// o contrato das recusas e que uma analise que falha (antivirus fora, arquivo grande) devolve
// a vaga.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import {
  ADMIN, ANALISTA, SENHA_CONTA, chamar, criarUsuario, encerrarServidor, iniciarServidor, login, prepararBanco, urlBase,
} from '../helpers.js';
import { enviarArquivoEmFluxo, lerInstream } from '../envioEmFluxo.js';

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');
const { LIMITE_ANALISES_POR_HORA, LIMITE_ANALISES_SIMULTANEAS, LIMITE_ANEXOS_POR_CAMPANHA, LIMITE_ARQUIVO_BYTES } = await import('../../src/models/analiseArquivo.model.js');

const RAJADA_HORA = 25;
const RAJADA_ANEXOS = 8;
const MSG_HORA = 'Limite de análises por hora atingido. Tente novamente mais tarde.';
const MSG_ANEXOS = `Limite de ${LIMITE_ANEXOS_POR_CAMPANHA} anexos por campanha atingido`;
/** O clamd falso segura o veredito: todas as requisicoes da rajada passam pelo limite antes. */
const DEMORA_CLAMD_MS = 300;

let clamd: Server;
let pedidosAoClamd = 0;

/** clamd falso (protocolo INSTREAM), lento de proposito; tudo e "stream: OK". */
function falsoClamd(socket: Socket) {
  lerInstream(socket, () => {
    pedidosAoClamd += 1;
    setTimeout(() => socket.end('stream: OK\0'), DEMORA_CLAMD_MS);
  });
}

let admin = '';
let analista = '';
let portaClamd = '';

before(async () => {
  assert.ok(RAJADA_HORA > LIMITE_ANALISES_POR_HORA && RAJADA_ANEXOS > LIMITE_ANEXOS_POR_CAMPANHA);
  // allowHalfOpen: o cliente fecha o lado dele ao terminar o envio; sem isto o socket fecha antes
  // do veredito atrasado.
  clamd = createServer({ allowHalfOpen: true }, falsoClamd);
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', ok));
  portaClamd = String((clamd.address() as AddressInfo).port);
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = portaClamd;
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
});

after(async () => {
  await encerrarServidor();
  await new Promise<void>((ok) => clamd.close(() => ok()));
  await prisma.$disconnect();
});

type Envio = { status: number; body: any };

/** Envia multipart de verdade (fetch + FormData), como o navegador. */
async function enviar(token: string, conteudo: Buffer | string, query = ''): Promise<Envio> {
  const form = new FormData();
  form.append('arquivo', new Blob([typeof conteudo === 'string' ? conteudo : new Uint8Array(conteudo)]), 'anexo.txt');
  const r = await fetch(`${urlBase()}/arquivos/analise${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: r.status, body: (await r.json()) as any };
}

const rajada = (n: number, envio: (i: number) => Promise<Envio>) => Promise.all(Array.from({ length: n }, (_, i) => envio(i)));

function separar(respostas: Envio[]) {
  const por = (s: number) => respostas.filter((r) => r.status === s);
  return { s201: por(201), s429: por(429) };
}

/** Toda recusa e o 429 do contrato, com o codigo e a mensagem de hoje. */
function conferirRecusas(respostas: Envio[], codigo: string, mensagem: string) {
  for (const r of respostas) {
    if (r.status === 201) continue;
    assert.equal(r.status, 429, `status inesperado na rajada: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.status, 'erro');
    assert.equal(r.body.codigoErro, codigo);
    assert.equal(r.body.mensagem, mensagem);
  }
}

/**
 * Analises ja feitas (FileScan), gravadas direto: com no maximo 2 analises simultaneas por
 * usuario (Melhorias #18), uma rajada nao chega mais sozinha ao limite por hora nem ao do evento;
 * para exercitar a corrida desses limites, o usuario ja comeca a um passo deles.
 */
async function jaAnalisadas(userId: string, n: number, campaignEventId: string | null = null) {
  await prisma.fileScan.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      userId,
      nome: `anterior-${i}.txt`,
      tamanho: 1,
      sha256: i.toString(16).padStart(64, '0'),
      resultado: 'LIMPO',
      campaignEventId,
    })),
  });
}

async function novoColaborador(prefixo: string) {
  const c = await criarUsuario(admin, 'Colaborador', prefixo);
  return { ...c, token: await login(c.email, SENHA_CONTA) };
}

/** Pede ao clamd uma porta sem servidor (antivirus fora do ar) durante `fn`. */
async function comAntivirusFora<T>(fn: () => Promise<T>): Promise<T> {
  process.env.CLAMAV_PORT = '1';
  try {
    return await fn();
  } finally {
    process.env.CLAMAV_PORT = portaClamd;
  }
}

// =============================================================================
describe('DT09: limite de análises por hora sob rajada paralela', () => {
  it(`a um passo do limite (${LIMITE_ANALISES_POR_HORA - 1} já feitas), ${RAJADA_HORA} envios simultâneos: só 1 chega ao antivírus, o resto é 429 MUITAS_ANALISES`, async (t) => {
    const c = await novoColaborador('rajada.arquivo');
    await jaAnalisadas(c.id, LIMITE_ANALISES_POR_HORA - 1);
    const antes = pedidosAoClamd;
    const respostas = await rajada(RAJADA_HORA, (i) => enviar(c.token, `arquivo ${i}`));
    conferirRecusas(respostas, 'MUITAS_ANALISES', MSG_HORA);
    const { s201, s429 } = separar(respostas);
    assert.equal(s201.length, 1, `${s201.length} análises aceitas (restava 1 vaga na hora)`);
    assert.equal(s201.length + s429.length, RAJADA_HORA);
    const gravadas = await prisma.fileScan.count({ where: { userId: c.id } });
    assert.equal(gravadas, LIMITE_ANALISES_POR_HORA, 'um registro por análise aceita, nenhum a mais');
    assert.equal(pedidosAoClamd - antes, 1, `${pedidosAoClamd - antes} arquivos chegaram ao antivírus`);
    t.diagnostic(`hora: ${s201.length} x 201, ${s429.length} x 429, ${pedidosAoClamd - antes} pedidos ao clamd`);
  });
});

// =============================================================================
describe('Melhorias #18: no máximo 2 análises simultâneas por usuário (contra o slowloris autenticado)', () => {
  it(`${RAJADA_HORA} envios simultâneos de um usuário novo: só ${LIMITE_ANALISES_SIMULTANEAS} chegam ao antivírus, o resto é 429 ANALISES_SIMULTANEAS`, async (t) => {
    const c = await novoColaborador('rajada.simultanea');
    const antes = pedidosAoClamd;
    const respostas = await rajada(RAJADA_HORA, (i) => enviar(c.token, `simultanea ${i}`));
    conferirRecusas(respostas, 'ANALISES_SIMULTANEAS', `Já há ${LIMITE_ANALISES_SIMULTANEAS} análises suas em andamento. Aguarde uma terminar.`);
    const { s201, s429 } = separar(respostas);
    assert.equal(s201.length, LIMITE_ANALISES_SIMULTANEAS);
    assert.equal(s429.length, RAJADA_HORA - LIMITE_ANALISES_SIMULTANEAS);
    assert.equal(pedidosAoClamd - antes, LIMITE_ANALISES_SIMULTANEAS, 'o resto nem chega ao antivírus');
    // O limite é por usuário: outro usuário na mesma hora segue livre.
    const outro = await novoColaborador('rajada.simultanea.outro');
    assert.equal((await enviar(outro.token, 'de outra pessoa')).status, 201);
    t.diagnostic(`simultâneas: ${s201.length} x 201, ${s429.length} x 429`);
  });
});

// =============================================================================
describe('DT09: limite de anexos por destinatário na campanha sob rajada paralela', () => {
  it(`a um passo do limite do evento, ${RAJADA_ANEXOS} anexos simultâneos: só 1 passa, o resto é 429 LIMITE_ANEXOS_CAMPANHA`, async (t) => {
    const c = await novoColaborador('rajada.anexo');
    const camp = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Rajada de anexos', destinatarios: [c.email], template: 'urgencia' },
    });
    assert.equal(camp.status, 201, JSON.stringify(camp.body));
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: camp.body.dados.idCampanha } });
    assert.ok(evento.enviadoEm, 'o e-mail da campanha saiu');
    await jaAnalisadas(c.id, LIMITE_ANEXOS_POR_CAMPANHA - 1, evento.id);

    const respostas = await rajada(RAJADA_ANEXOS, (i) => enviar(c.token, `anexo ${i}`, `?eventoCampanha=${evento.id}`));
    conferirRecusas(respostas, 'LIMITE_ANEXOS_CAMPANHA', MSG_ANEXOS);
    const { s201, s429 } = separar(respostas);
    assert.equal(s201.length, 1, `${s201.length} anexos aceitos (restava 1 vaga no evento)`);
    assert.equal(s201.length + s429.length, RAJADA_ANEXOS);
    assert.equal(await prisma.fileScan.count({ where: { campaignEventId: evento.id } }), LIMITE_ANEXOS_POR_CAMPANHA);
    // O limite e do evento, nao do usuario: o envio avulso segue.
    assert.equal((await enviar(c.token, 'avulso')).status, 201);
    t.diagnostic(`anexos: ${s201.length} x 201, ${s429.length} x 429`);
  });
});

// =============================================================================
describe('DT09: análise que falha devolve a vaga', () => {
  it('antivírus fora do ar (503) numa rajada: nenhuma vaga fica presa, e os envios seguintes usam o limite inteiro', async () => {
    const c = await novoColaborador('rajada.falha');
    const falhas = await comAntivirusFora(() => rajada(RAJADA_HORA, (i) => enviar(c.token, `falha ${i}`)));
    // Com as vagas reservadas em curso, parte da rajada dá 429 (simultâneas); nenhuma passa.
    for (const r of falhas) {
      if (r.status === 429) assert.equal(r.body.codigoErro, 'ANALISES_SIMULTANEAS');
      else {
        assert.equal(r.status, 503, JSON.stringify(r.body));
        assert.equal(r.body.codigoErro, 'ANTIVIRUS_INDISPONIVEL');
      }
    }
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), 0);
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "FileScanReserva" WHERE "userId" = ${c.id}`;
    assert.equal(n, 0, 'nenhuma reserva presa');

    // As vagas voltaram: em pares (no máximo 2 simultâneas), passa exatamente o limite da hora.
    let aceitas = 0;
    for (let i = 0; i < RAJADA_HORA; i += LIMITE_ANALISES_SIMULTANEAS) {
      const par = await rajada(Math.min(LIMITE_ANALISES_SIMULTANEAS, RAJADA_HORA - i), (j) => enviar(c.token, `depois ${i + j}`));
      for (const r of par) if (r.status === 201) aceitas += 1;
      else assert.equal(r.body.codigoErro, 'MUITAS_ANALISES', JSON.stringify(r.body));
    }
    assert.equal(aceitas, LIMITE_ANALISES_POR_HORA);
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), LIMITE_ANALISES_POR_HORA);
  });

  it('arquivo grande (413) e antivírus fora (503) no anexo de campanha devolvem a vaga do evento', async () => {
    const c = await novoColaborador('rajada.falha.anexo');
    const camp = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Anexo que falha', destinatarios: [c.email], template: 'curiosidade' },
    });
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: camp.body.dados.idCampanha } });
    const q = `?eventoCampanha=${evento.id}`;
    for (let i = 0; i < LIMITE_ANEXOS_POR_CAMPANHA - 1; i++) assert.equal((await enviar(c.token, `ok ${i}`, q)).status, 201);
    // Resta uma vaga no evento. Nenhuma das falhas a consome.
    const grande = await enviarArquivoEmFluxo({ token: c.token, tamanho: LIMITE_ARQUIVO_BYTES + 1, query: q });
    assert.equal(grande.status, 413, JSON.stringify(grande.body));
    assert.equal(grande.body.codigoErro, 'ARQUIVO_MUITO_GRANDE');
    const fora = await comAntivirusFora(() => enviar(c.token, 'fora', q));
    assert.equal(fora.status, 503, JSON.stringify(fora.body));
    // Sem arquivo no corpo (400 antes do antivirus) tambem nao consome.
    const form = new FormData();
    const semArquivo = await fetch(`${urlBase()}/arquivos/analise${q}`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}` }, body: form });
    assert.equal(semArquivo.status, 400);

    assert.equal((await enviar(c.token, 'ultimo', q)).status, 201, 'a vaga do evento voltou');
    const sexto = await enviar(c.token, 'sexto', q);
    assert.equal(sexto.status, 429);
    assert.equal(sexto.body.codigoErro, 'LIMITE_ANEXOS_CAMPANHA');
    assert.equal(await prisma.fileScan.count({ where: { campaignEventId: evento.id } }), LIMITE_ANEXOS_POR_CAMPANHA);
    // Nenhuma reserva fica para tras depois das respostas.
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "FileScanReserva" WHERE "userId" = ${c.id}`;
    assert.equal(n, 0);
  });
});
