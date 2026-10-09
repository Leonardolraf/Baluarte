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

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');
const { LIMITE_ANALISES_POR_HORA, LIMITE_ANEXOS_POR_CAMPANHA } = await import('../../src/models/analiseArquivo.model.js');

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
  let bruto = Buffer.alloc(0);
  socket.on('data', (d) => {
    bruto = Buffer.concat([bruto, d]);
    let pos = 'zINSTREAM\0'.length;
    while (pos + 4 <= bruto.length) {
      const n = bruto.readUInt32BE(pos);
      if (n === 0) {
        pedidosAoClamd += 1;
        setTimeout(() => socket.end('stream: OK\0'), DEMORA_CLAMD_MS);
        return;
      }
      if (pos + 4 + n > bruto.length) return;
      pos += 4 + n;
    }
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
  it(`${RAJADA_HORA} envios simultâneos do mesmo usuário: no máximo ${LIMITE_ANALISES_POR_HORA} chegam ao antivírus, o resto é 429 MUITAS_ANALISES`, async (t) => {
    const c = await novoColaborador('rajada.arquivo');
    const antes = pedidosAoClamd;
    const respostas = await rajada(RAJADA_HORA, (i) => enviar(c.token, `arquivo ${i}`));
    conferirRecusas(respostas, 'MUITAS_ANALISES', MSG_HORA);
    const { s201, s429 } = separar(respostas);
    assert.ok(s201.length <= LIMITE_ANALISES_POR_HORA, `${s201.length} análises aceitas (limite ${LIMITE_ANALISES_POR_HORA})`);
    assert.equal(s201.length + s429.length, RAJADA_HORA);
    const gravadas = await prisma.fileScan.count({ where: { userId: c.id } });
    assert.equal(gravadas, s201.length, 'um registro por análise aceita, nenhum a mais');
    assert.ok(pedidosAoClamd - antes <= LIMITE_ANALISES_POR_HORA, `${pedidosAoClamd - antes} arquivos chegaram ao antivírus`);
    t.diagnostic(`hora: ${s201.length} x 201, ${s429.length} x 429, ${pedidosAoClamd - antes} pedidos ao clamd`);
  });
});

// =============================================================================
describe('DT09: limite de anexos por destinatário na campanha sob rajada paralela', () => {
  it(`${RAJADA_ANEXOS} anexos simultâneos para o mesmo evento: no máximo ${LIMITE_ANEXOS_POR_CAMPANHA} passam, o resto é 429 LIMITE_ANEXOS_CAMPANHA`, async (t) => {
    const c = await novoColaborador('rajada.anexo');
    const camp = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Rajada de anexos', destinatarios: [c.email], template: 'urgencia' },
    });
    assert.equal(camp.status, 201, JSON.stringify(camp.body));
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: camp.body.dados.idCampanha } });
    assert.ok(evento.enviadoEm, 'o e-mail da campanha saiu');

    const respostas = await rajada(RAJADA_ANEXOS, (i) => enviar(c.token, `anexo ${i}`, `?eventoCampanha=${evento.id}`));
    conferirRecusas(respostas, 'LIMITE_ANEXOS_CAMPANHA', MSG_ANEXOS);
    const { s201, s429 } = separar(respostas);
    assert.ok(s201.length <= LIMITE_ANEXOS_POR_CAMPANHA, `${s201.length} anexos aceitos (limite ${LIMITE_ANEXOS_POR_CAMPANHA})`);
    assert.equal(s201.length + s429.length, RAJADA_ANEXOS);
    assert.equal(await prisma.fileScan.count({ where: { campaignEventId: evento.id } }), s201.length);
    // O limite e do evento, nao do usuario: o envio avulso segue.
    assert.equal((await enviar(c.token, 'avulso')).status, 201);
    t.diagnostic(`anexos: ${s201.length} x 201, ${s429.length} x 429`);
  });
});

// =============================================================================
describe('DT09: análise que falha devolve a vaga', () => {
  it('antivírus fora do ar (503) numa rajada: nenhuma vaga fica presa, e a rajada seguinte usa o limite inteiro', async () => {
    const c = await novoColaborador('rajada.falha');
    const falhas = await comAntivirusFora(() => rajada(RAJADA_HORA, (i) => enviar(c.token, `falha ${i}`)));
    // Com as vagas reservadas em curso, parte da rajada pode dar 429; nenhuma passa.
    for (const r of falhas) {
      if (r.status === 429) assert.equal(r.body.codigoErro, 'MUITAS_ANALISES');
      else {
        assert.equal(r.status, 503, JSON.stringify(r.body));
        assert.equal(r.body.codigoErro, 'ANTIVIRUS_INDISPONIVEL');
      }
    }
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), 0);

    // As vagas voltaram: a rajada seguinte, com o antivirus no ar, passa exatamente o limite.
    const respostas = await rajada(RAJADA_HORA, (i) => enviar(c.token, `depois ${i}`));
    conferirRecusas(respostas, 'MUITAS_ANALISES', MSG_HORA);
    assert.equal(separar(respostas).s201.length, LIMITE_ANALISES_POR_HORA);
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
    const grande = await enviar(c.token, Buffer.alloc(10 * 1024 * 1024 + 1, 65), q);
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
