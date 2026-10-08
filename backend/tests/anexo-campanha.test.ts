// Testes de integracao do B23: anexo suspeito recebido numa campanha de phishing simulado,
// enviado para analise pelo proprio destinatario (com login), e veredito de regra YARA propria
// do Baluarte. API real + Postgres isolado (helpers.ts) e um clamd FALSO em TCP local que
// responde como o ClamAV com as regras de antivirus/regras carregadas (nome da regra YARA).
// Nada de EICAR nem de material malicioso: as amostras sao textos inofensivos, montados em
// memoria a partir de partes (o fonte nao contem o marcador inteiro).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  ADMIN, ANALISTA, SENHA_CONTA, chamar, criarUsuario, encerrarServidor, esperaErro, iniciarServidor, login,
  prepararBanco, urlBase,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { caixaDeSaida } = await import('../src/config/email.js');

/** Marcador de teste do Baluarte (antivirus/regras/baluarte_teste.yar), montado em partes. */
const MARCADOR = ['BALUARTE', 'TESTE', 'AMEACA', '0001', 'ARQUIVO', 'INOFENSIVO'].join('-');
/** Documento sintetico com o par gatilho + chamada ao sistema da regra de macro (so texto). */
const MACRO = ['Sub Document', '_Open()\n', '  Set s = Create', 'Object("WScript.', 'Shell")\n', 'End Sub\n'].join('');

let clamd: Server;
let pedidosAoClamd = 0;

/** clamd falso: devolve o nome da regra YARA como o ClamAV real com as regras do Baluarte. */
function falsoClamd(socket: Socket) {
  let bruto = Buffer.alloc(0);
  socket.on('data', (d) => {
    bruto = Buffer.concat([bruto, d]);
    let pos = 'zINSTREAM\0'.length;
    const partes: Buffer[] = [];
    while (pos + 4 <= bruto.length) {
      const n = bruto.readUInt32BE(pos);
      if (n === 0) {
        pedidosAoClamd += 1;
        const conteudo = Buffer.concat(partes).toString('latin1');
        if (conteudo.includes(MARCADOR)) socket.end('stream: YARA.BaluarteMarcadorTeste.UNOFFICIAL FOUND\0');
        else if (conteudo.includes('Document_Open') && conteudo.includes('CreateObject'))
          socket.end('stream: YARA.BaluarteMacroSuspeita.UNOFFICIAL FOUND\0');
        else if (conteudo.includes('assinatura-oficial')) socket.end('stream: Win.Test.Oficial-1 FOUND\0');
        else socket.end('stream: OK\0');
        return;
      }
      if (pos + 4 + n > bruto.length) return;
      partes.push(bruto.subarray(pos + 4, pos + 4 + n));
      pos += 4 + n;
    }
  });
}

const FRONTEND = 'http://localhost:5173';
const LINK = new RegExp(`${FRONTEND}/t/([0-9a-f]{64})(?!/)`);

let admin = '';
let analista = '';
let ana: { id: string; email: string; token: string; link: string };
let bruno: { id: string; email: string; token: string; link: string };
let campanhaId = '';
let eventoAna = '';
let eventoBruno = '';

before(async () => {
  clamd = createServer(falsoClamd);
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', ok));
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String((clamd.address() as AddressInfo).port);
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  const a = await criarUsuario(admin, 'Colaborador', 'anexo-ana');
  const b = await criarUsuario(admin, 'Colaborador', 'anexo-bruno');

  const desde = caixaDeSaida.length;
  const r = await chamar('POST', '/campaigns', {
    token: analista,
    body: { nome: 'Fatura com anexo', destinatarios: [a.email, b.email], template: 'urgencia' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  campanhaId = r.body.dados.idCampanha;
  const linkDe = (email: string) => {
    const msg = caixaDeSaida.slice(desde).find((e) => e.para === email);
    const m = msg?.texto.match(LINK);
    assert.ok(m, `e-mail da campanha para ${email}`);
    return m[1];
  };
  ana = { ...a, token: await login(a.email, SENHA_CONTA), link: linkDe(a.email) };
  bruno = { ...b, token: await login(b.email, SENHA_CONTA), link: linkDe(b.email) };
  const eventos = await prisma.campaignEvent.findMany({ where: { campaignId: campanhaId } });
  eventoAna = eventos.find((e) => e.userId === ana.id)!.id;
  eventoBruno = eventos.find((e) => e.userId === bruno.id)!.id;
});

after(async () => {
  await encerrarServidor();
  await new Promise<void>((ok) => clamd.close(() => ok()));
  await prisma.$disconnect();
});

/** Envia multipart de verdade (fetch + FormData), com a origem na query. */
async function enviar(token: string | null, conteudo: Buffer | string, query = '', nome = 'anexo.txt') {
  const form = new FormData();
  form.append('arquivo', new Blob([typeof conteudo === 'string' ? conteudo : new Uint8Array(conteudo)]), nome);
  const r = await fetch(`${urlBase()}/arquivos/analise${query}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return { status: r.status, body: (await r.json()) as any };
}

describe('regra YARA própria do Baluarte (B23)', () => {
  it('marcador de teste: AMEACA com o nome da regra, rótulo "regra própria do Baluarte" na mensagem e regraPropria', async () => {
    const r = await enviar(ana.token, `relatorio\n${MARCADOR}\n`, '', 'marcador.txt');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.resultado, 'AMEACA');
    assert.equal(r.body.dados.ameaca, 'YARA.BaluarteMarcadorTeste.UNOFFICIAL');
    assert.equal(r.body.dados.regraPropria, true);
    assert.equal(r.body.mensagem, 'Ameaça encontrada: YARA.BaluarteMarcadorTeste.UNOFFICIAL (regra própria do Baluarte)');
    assert.equal(r.body.dados.campanha, null, 'envio avulso não tem campanha');
  });

  it('documento sintético com macro: regra de macro suspeita, também própria', async () => {
    const r = await enviar(ana.token, MACRO, '', 'pedido.doc');
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.ameaca, 'YARA.BaluarteMacroSuspeita.UNOFFICIAL');
    assert.equal(r.body.dados.regraPropria, true);
  });

  it('assinatura oficial do ClamAV e arquivo limpo: regraPropria false e mensagem sem o rótulo', async () => {
    const oficial = await enviar(ana.token, 'assinatura-oficial', '', 'x.exe');
    assert.equal(oficial.body.dados.ameaca, 'Win.Test.Oficial-1');
    assert.equal(oficial.body.dados.regraPropria, false);
    assert.equal(oficial.body.mensagem, 'Ameaça encontrada: Win.Test.Oficial-1');
    const limpo = await enviar(ana.token, 'ata da reuniao', '', 'ata.txt');
    assert.equal(limpo.body.dados.regraPropria, false);
    assert.equal(limpo.body.mensagem, 'Nenhuma ameaça conhecida encontrada');
  });

  it('o histórico traz regraPropria e o dashboard conta a detecção de regra própria como arquivo malicioso', async () => {
    const hist = await chamar('GET', '/arquivos/analises?resultado=AMEACA&tamanho=100', { token: ana.token });
    const marcador = hist.body.dados.find((a: any) => a.nome === 'marcador.txt');
    assert.equal(marcador.regraPropria, true);
    const painel = await chamar('GET', '/dashboard', { token: analista });
    assert.ok(painel.body.dados.kpis.arquivosMaliciosos >= 3);
  });
});

describe('GET /arquivos/campanhas-recebidas (B23)', () => {
  it('lista só as campanhas recebidas pelo próprio usuário, com o id do evento', async () => {
    const r = await chamar('GET', '/arquivos/campanhas-recebidas', { token: ana.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.length, 1);
    assert.equal(r.body.dados[0].id, eventoAna);
    assert.deepEqual(r.body.dados[0].campanha, { id: campanhaId, nome: 'Fatura com anexo' });
    assert.ok(r.body.dados[0].recebidaEm);
    assert.equal(r.body.resumo.selecionada, null);
    assert.doesNotMatch(JSON.stringify(r.body), /tokenHash|[0-9a-f]{64}/, 'nunca devolve token nem hash');
    // Quem não recebeu campanha nenhuma (o analista que a criou) vê lista vazia.
    const op = await chamar('GET', '/arquivos/campanhas-recebidas', { token: analista });
    assert.deepEqual(op.body.dados, []);
  });

  it('com o link do próprio e-mail, pré-seleciona o evento; link de outra pessoa ou desconhecido dá null, sem erro', async () => {
    const proprio = await chamar('GET', `/arquivos/campanhas-recebidas?link=${ana.link}`, { token: ana.token });
    assert.equal(proprio.body.resumo.selecionada, eventoAna);
    const alheio = await chamar('GET', `/arquivos/campanhas-recebidas?link=${bruno.link}`, { token: ana.token });
    assert.equal(alheio.status, 200);
    assert.equal(alheio.body.resumo.selecionada, null);
    const desconhecido = await chamar('GET', `/arquivos/campanhas-recebidas?link=${'f'.repeat(64)}`, { token: ana.token });
    assert.equal(desconhecido.body.resumo.selecionada, null);
  });

  it('link fora do formato: 400 LINK_INVALIDO (inclusive objeto na query); sem login: 401', async () => {
    for (const q of ['?link=abc', `?link=${'G'.repeat(64)}`, '?link[$ne]=x', `?link=${ana.link}&link=${ana.link}`]) {
      esperaErro(await chamar('GET', `/arquivos/campanhas-recebidas${q}`, { token: ana.token }), 400, 'LINK_INVALIDO');
    }
    esperaErro(await chamar('GET', '/arquivos/campanhas-recebidas'), 401, 'TOKEN_AUSENTE');
  });
});

describe('POST /arquivos/analise?eventoCampanha= (anexo suspeito de campanha, B23)', () => {
  it('liga a análise à campanha: 201 com a campanha na resposta, no registro, no histórico e na auditoria', async () => {
    const r = await enviar(ana.token, `fatura\n${MARCADOR}\n`, `?eventoCampanha=${eventoAna}`, 'fatura.pdf.txt');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.dados.campanha, { id: campanhaId, nome: 'Fatura com anexo' });
    assert.equal(r.body.dados.regraPropria, true);
    const reg = await prisma.fileScan.findUniqueOrThrow({ where: { id: r.body.dados.id } });
    assert.equal(reg.campaignEventId, eventoAna);
    assert.equal(reg.userId, ana.id);
    const hist = await chamar('GET', '/arquivos/analises?tamanho=100', { token: ana.token });
    assert.deepEqual(hist.body.dados.find((a: any) => a.id === r.body.dados.id).campanha, { id: campanhaId, nome: 'Fatura com anexo' });
    const log = await prisma.auditLog.findFirst({ where: { usuarioId: ana.id, acao: 'ANALISAR_ARQUIVO', detalhe: { contains: 'fatura.pdf.txt' } } });
    assert.match(log!.detalhe ?? '', new RegExp(`anexo da campanha Fatura com anexo \\(${campanhaId}\\)`));
    const lista = await chamar('GET', '/arquivos/campanhas-recebidas', { token: ana.token });
    assert.equal(lista.body.dados[0].anexosEnviados, 1);
  });

  it('evento de outra pessoa ou inexistente: 404 CAMPANHA_NAO_RECEBIDA, sem chegar ao antivírus e sem registro', async () => {
    const antes = { clamd: pedidosAoClamd, registros: await prisma.fileScan.count() };
    esperaErro(await toResposta(enviar(bruno.token, 'x', `?eventoCampanha=${eventoAna}`)), 404, 'CAMPANHA_NAO_RECEBIDA');
    esperaErro(await toResposta(enviar(ana.token, 'x', '?eventoCampanha=evento-que-nao-existe')), 404, 'CAMPANHA_NAO_RECEBIDA');
    // O operador que criou a campanha também não envia anexo "em nome" do destinatário.
    esperaErro(await toResposta(enviar(analista, 'x', `?eventoCampanha=${eventoAna}`)), 404, 'CAMPANHA_NAO_RECEBIDA');
    assert.equal(pedidosAoClamd, antes.clamd, 'nada foi enviado ao clamd');
    assert.equal(await prisma.fileScan.count(), antes.registros);
  });

  it('evento cujo e-mail não saiu: 404 (só campanha recebida aceita anexo)', async () => {
    await prisma.campaignEvent.update({ where: { id: eventoBruno }, data: { enviadoEm: null } });
    try {
      esperaErro(await toResposta(enviar(bruno.token, 'x', `?eventoCampanha=${eventoBruno}`)), 404, 'CAMPANHA_NAO_RECEBIDA');
      const lista = await chamar('GET', '/arquivos/campanhas-recebidas', { token: bruno.token });
      assert.deepEqual(lista.body.dados, []);
    } finally {
      await prisma.campaignEvent.update({ where: { id: eventoBruno }, data: { enviadoEm: new Date() } });
    }
  });

  it('origem fora do formato: 400 EVENTO_CAMPANHA_INVALIDO (inclusive objeto e lista); vazio conta como envio avulso', async () => {
    for (const q of ['?eventoCampanha=a%20b', `?eventoCampanha=${'a'.repeat(65)}`, '?eventoCampanha[$ne]=x', `?eventoCampanha=${eventoAna}&eventoCampanha=${eventoAna}`]) {
      esperaErro(await toResposta(enviar(ana.token, 'x', q)), 400, 'EVENTO_CAMPANHA_INVALIDO');
    }
    const vazio = await enviar(ana.token, 'nada', '?eventoCampanha=');
    assert.equal(vazio.status, 201);
    assert.equal(vazio.body.dados.campanha, null);
  });

  it('sem login: 401 (não há envio pelo link público)', async () => {
    esperaErro(await toResposta(enviar(null, 'x', `?eventoCampanha=${eventoAna}`)), 401, 'TOKEN_AUSENTE');
  });

  it('mesmo limite de tamanho: acima de 10 MB dá 413 e nada é registrado', async () => {
    const antes = await prisma.fileScan.count({ where: { campaignEventId: eventoBruno } });
    const r = await enviar(bruno.token, Buffer.alloc(10 * 1024 * 1024 + 1, 65), `?eventoCampanha=${eventoBruno}`, 'grande.bin');
    assert.equal(r.status, 413);
    assert.equal(r.body.codigoErro, 'ARQUIVO_MUITO_GRANDE');
    assert.equal(await prisma.fileScan.count({ where: { campaignEventId: eventoBruno } }), antes);
  });

  it('no máximo 5 anexos por destinatário na campanha: o 6.º dá 429 LIMITE_ANEXOS_CAMPANHA (o envio avulso segue)', async () => {
    const ja = await prisma.fileScan.count({ where: { campaignEventId: eventoBruno } });
    for (let i = ja; i < 5; i++) {
      const r = await enviar(bruno.token, `anexo ${i}${i === 0 ? `\n${MACRO}` : ''}`, `?eventoCampanha=${eventoBruno}`, `anexo-${i}.doc`);
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const sexto = await enviar(bruno.token, 'mais um', `?eventoCampanha=${eventoBruno}`);
    assert.equal(sexto.status, 429);
    assert.equal(sexto.body.codigoErro, 'LIMITE_ANEXOS_CAMPANHA');
    assert.equal((await enviar(bruno.token, 'avulso')).status, 201);
  });

  it('o limite por hora continua valendo para o anexo de campanha', async () => {
    const c = await criarUsuario(admin, 'Colaborador', 'anexo-limite');
    const token = await login(c.email, SENHA_CONTA);
    const camp = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Limite', destinatarios: [c.email], template: 'curiosidade' } });
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: camp.body.dados.idCampanha } });
    await prisma.fileScan.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({ userId: c.id, nome: `f${i}`, tamanho: 1, sha256: 'b'.repeat(64), resultado: 'LIMPO' })),
    });
    esperaErro(await toResposta(enviar(token, 'x', `?eventoCampanha=${evento.id}`)), 429, 'MUITAS_ANALISES');
  });
});

describe('relatório da campanha: anexos reportados e vereditos (B23)', () => {
  it('operadores veem quantos anexos foram reportados, quantos com ameaça e de regra própria, e a lista', async () => {
    for (const token of [analista, admin]) {
      const r = await chamar('GET', `/campanhas/${campanhaId}`, { token });
      assert.equal(r.status, 200);
      const { anexos } = r.body.dados;
      const noBanco = await prisma.fileScan.findMany({ where: { campaignEvent: { campaignId: campanhaId } } });
      assert.equal(anexos.total, noBanco.length);
      assert.equal(anexos.total, 6, '1 da Ana + 5 do Bruno');
      assert.equal(anexos.ameacas, noBanco.filter((a) => a.resultado === 'AMEACA').length);
      assert.equal(anexos.ameacas, 2, 'marcador da Ana + macro do Bruno');
      assert.equal(anexos.regrasProprias, 2);
      const daAna = anexos.lista.find((a: any) => a.nome === 'fatura.pdf.txt');
      assert.equal(daAna.destinatario, ana.email);
      assert.equal(daAna.ameaca, 'YARA.BaluarteMarcadorTeste.UNOFFICIAL');
      assert.equal(daAna.regraPropria, true);
      assert.equal(daAna.resultado, 'AMEACA');
      assert.ok(anexos.lista.every((a: any) => a.destinatario === ana.email || a.destinatario === bruno.email));
    }
  });

  it('o Colaborador não lê o relatório da campanha (403)', async () => {
    esperaErro(await chamar('GET', `/campanhas/${campanhaId}`, { token: ana.token }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('campanha sem anexos: anexos zerados', async () => {
    const c = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Sem anexo', destinatarios: [ana.email], template: 'autoridade' } });
    const r = await chamar('GET', `/campanhas/${c.body.dados.idCampanha}`, { token: analista });
    assert.deepEqual(r.body.dados.anexos, { total: 0, ameacas: 0, regrasProprias: 0, lista: [] });
  });

  it('excluir a campanha preserva as análises (a origem vira nula, FK SET NULL)', async () => {
    const ids = (await prisma.fileScan.findMany({ where: { campaignEvent: { campaignId: campanhaId } }, select: { id: true } })).map((a) => a.id);
    assert.equal((await chamar('DELETE', `/campanhas/${campanhaId}`, { token: analista })).status, 200);
    const depois = await prisma.fileScan.findMany({ where: { id: { in: ids } } });
    assert.equal(depois.length, ids.length);
    assert.ok(depois.every((a) => a.campaignEventId === null));
    const hist = await chamar('GET', '/arquivos/analises?tamanho=100', { token: ana.token });
    assert.equal(hist.body.dados.find((a: any) => a.nome === 'fatura.pdf.txt').campanha, null);
  });
});

/** Converte a resposta do envio multipart no formato que `esperaErro` espera. */
async function toResposta(p: ReturnType<typeof enviar>) {
  const r = await p;
  return { status: r.status, body: r.body, headers: new Headers() };
}
