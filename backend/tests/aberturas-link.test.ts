// Melhorias #6: cada abertura do link do e-mail da campanha (GET /treinamentos/link/:token)
// grava uma linha em CampaignLinkHit com IP e user-agent, no maximo uma por janela de 30 min e
// ate 50 por evento (link publico: F5, prefetch e loop nao inflam nem enchem o disco); o relatorio da campanha mostra
// quantas vezes cada destinatario abriu e marca possivel repasse (> 1), sem nunca expor IP
// nem user-agent. O clique do funil continua um por pessoa. Retencao LGPD de 90 dias sem
// cron: cada abertura anula IP/user-agent das aberturas mais velhas. Banco isolado (helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN,
  ANALISTA,
  chamar,
  criarUsuario,
  encerrarServidor,
  iniciarServidor,
  login,
  prepararBanco,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { hashToken } = await import('../src/utils/tokens.js');
const repo = await import('../src/repositories/treinamento.repository.js');
const { JANELA_ABERTURA_MS, RETENCAO_DADOS_ABERTURA_DIAS, TETO_ABERTURAS_POR_EVENTO, USER_AGENT_ABERTURA_MAX, dadosDaAbertura } =
  await import('../src/models/treinamento.model.js');

const DIA_MS = 86_400_000;
const MIN_MS = 60_000;
const UA = 'Mozilla/5.0 (Teste Aberturas) Baluarte/1.0';

let analista = '';
let ana: { id: string; email: string };
let bruno: { id: string; email: string };
let seq = 0;

before(async () => {
  await iniciarServidor(app);
  const admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  ana = await criarUsuario(admin, 'Colaborador', 'ana.aberturas');
  bruno = await criarUsuario(admin, 'Colaborador', 'bruno.aberturas');
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Campanha direto no banco, com um token de link conhecido por destinatario. */
async function campanhaCom(...pessoas: { id: string; email: string }[]) {
  seq += 1;
  const tokens = pessoas.map((_, i) => `${String(seq).padStart(4, '0')}${String(i).padStart(4, '0')}`.padEnd(64, 'a'));
  const c = await prisma.campaign.create({
    data: {
      nome: `Aberturas ${seq}`,
      template: 'urgencia',
      eventos: { create: pessoas.map((p, i) => ({ userId: p.id, destinatario: p.email, tokenHash: hashToken(tokens[i]), enviadoEm: new Date() })) },
    },
    include: { eventos: true },
  });
  const eventoDe = (email: string) => c.eventos.find((e) => e.destinatario === email)!.id;
  return { id: c.id, nome: c.nome, tokens, eventoDe };
}

const abrir = (token: string, ua = UA) => chamar('GET', `/treinamentos/link/${token}`, { headers: { 'User-Agent': ua } });

async function relatorio(id: string) {
  const r = await chamar('GET', `/campanhas/${id}`, { token: analista });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados;
}

describe('abertura do link grava CampaignLinkHit', () => {
  it('uma abertura grava uma linha com o IP do request e o user-agent', async () => {
    const c = await campanhaCom(ana);
    const r = await abrir(c.tokens[0]);
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const linhas = await prisma.campaignLinkHit.findMany({ where: { campaignEventId: c.eventoDe(ana.email) } });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].userAgent, UA);
    // Sem trust proxy, req.ip e o endereco do socket (loopback no teste).
    assert.match(linhas[0].ip ?? '', /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/);
  });

  it('sem TRUST_PROXY, um X-Forwarded-For forjado não muda o IP gravado', async () => {
    const c = await campanhaCom(ana);
    const r = await chamar('GET', `/treinamentos/link/${c.tokens[0]}`, {
      headers: { 'User-Agent': UA, 'X-Forwarded-For': '203.0.113.7, 198.51.100.9' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const linhas = await prisma.campaignLinkHit.findMany({ where: { campaignEventId: c.eventoDe(ana.email) } });
    assert.equal(linhas.length, 1);
    assert.match(linhas[0].ip ?? '', /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/);
  });

  it('aberturas em janelas diferentes contam e marcam possível repasse; o clique do funil continua 1 por pessoa', async () => {
    const c = await campanhaCom(ana, bruno);
    assert.equal((await abrir(c.tokens[0])).status, 200);
    const primeiro = (await prisma.campaignEvent.findUniqueOrThrow({ where: { id: c.eventoDe(ana.email) } })).clicadoEm;
    assert.ok(primeiro, 'a primeira abertura marca o clique');
    // A primeira abertura fica fora da janela de 30 min; as duas seguintes caem na mesma janela.
    await prisma.campaignLinkHit.updateMany({
      where: { campaignEventId: c.eventoDe(ana.email) },
      data: { registradoEm: new Date(Date.now() - 31 * MIN_MS) },
    });
    for (let i = 0; i < 2; i++) assert.equal((await abrir(c.tokens[0])).status, 200);
    assert.equal((await abrir(c.tokens[1])).status, 200);

    const ev = await prisma.campaignEvent.findUniqueOrThrow({ where: { id: c.eventoDe(ana.email) } });
    assert.equal(ev.clicadoEm?.getTime(), primeiro.getTime(), 'as aberturas seguintes não mexem no clique');
    const auditorias = await prisma.auditLog.count({ where: { acao: 'CLIQUE_LINK_PHISHING', detalhe: `${c.nome} / ${ana.email}` } });
    assert.equal(auditorias, 1, 'o clique (e a auditoria dele) é idempotente');

    const dados = await relatorio(c.id);
    assert.equal(dados.funil.clicados.valor, 2, 'o funil conta pessoas, não aberturas');
    const deAna = dados.treinamentos.find((t: { destinatario: string }) => t.destinatario === ana.email);
    const deBruno = dados.treinamentos.find((t: { destinatario: string }) => t.destinatario === bruno.email);
    assert.equal(deAna.aberturas, 2, 'uma por janela de 30 min');
    assert.equal(deAna.possivelRepasse, true);
    assert.equal(deBruno.aberturas, 1);
    assert.equal(deBruno.possivelRepasse, false);
    assert.deepEqual(dados.resumo, { aberturas: 3, possiveisRepasses: 1 });
  });

  it('campanha sem abertura: resumo zerado e ninguém na lista de cliques', async () => {
    const c = await campanhaCom(ana);
    const dados = await relatorio(c.id);
    assert.deepEqual(dados.resumo, { aberturas: 0, possiveisRepasses: 0 });
    assert.deepEqual(dados.treinamentos, []);
  });

  it('token inexistente não grava abertura', async () => {
    const antes = await prisma.campaignLinkHit.count();
    assert.equal((await abrir('f'.repeat(64))).status, 404);
    assert.equal(await prisma.campaignLinkHit.count(), antes);
  });

  it('user-agent acima do limite é truncado em 512 e o vazio vira null (CHECKs da tabela)', async () => {
    const c = await campanhaCom(ana);
    assert.equal((await abrir(c.tokens[0], 'x'.repeat(2000))).status, 200);
    const [linha] = await prisma.campaignLinkHit.findMany({ where: { campaignEventId: c.eventoDe(ana.email) } });
    assert.equal(linha.userAgent?.length, USER_AGENT_ABERTURA_MAX);

    assert.deepEqual(dadosDaAbertura({ ip: '', userAgent: '   ' }), { ip: null, userAgent: null });
    assert.deepEqual(dadosDaAbertura({}), { ip: null, userAgent: null });
    assert.equal(dadosDaAbertura({ ip: '1'.repeat(60) }).ip?.length, 45);
  });
});

describe(`dedup por janela de ${JANELA_ABERTURA_MS / MIN_MS} min e teto de ${TETO_ABERTURAS_POR_EVENTO} por evento`, () => {
  const linhasDe = (evento: string) => prisma.campaignLinkHit.count({ where: { campaignEventId: evento } });
  /** O link responde igual com ou sem a abertura contada. */
  function respostaIgual(r: { status: number; body: { status: string; dados: unknown } }, referencia: unknown) {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'sucesso');
    assert.deepEqual(r.body.dados, referencia);
  }
  const deAnaNo = async (id: string) =>
    (await relatorio(id)).treinamentos.find((t: { destinatario: string }) => t.destinatario === ana.email);

  it('as constantes são 30 min e 50', () => {
    assert.equal(JANELA_ABERTURA_MS, 30 * MIN_MS);
    assert.equal(TETO_ABERTURAS_POR_EVENTO, 50);
  });

  it('10 requisições seguidas ao link gravam 1 abertura', async () => {
    const c = await campanhaCom(ana);
    const primeira = await abrir(c.tokens[0]);
    assert.equal(primeira.status, 200);
    for (let i = 0; i < 9; i++) respostaIgual(await abrir(c.tokens[0]), primeira.body.dados);
    assert.equal(await linhasDe(c.eventoDe(ana.email)), 1);
    const deAna = await deAnaNo(c.id);
    assert.equal(deAna.aberturas, 1);
    assert.equal(deAna.possivelRepasse, false, 'F5 não vira possível repasse');
  });

  it('20 requisições concorrentes gravam 1 abertura', async () => {
    const c = await campanhaCom(ana);
    const referencia = (await abrir(c.tokens[0])).body.dados;
    // A chamada de referencia ja gravou; apaga para as 20 concorrerem pela primeira abertura.
    await prisma.campaignLinkHit.deleteMany({ where: { campaignEventId: c.eventoDe(ana.email) } });
    const respostas = await Promise.all(Array.from({ length: 20 }, () => abrir(c.tokens[0])));
    for (const r of respostas) respostaIgual(r, referencia);
    assert.equal(await linhasDe(c.eventoDe(ana.email)), 1);

    // Direto no repositorio, sem o resto da requisicao espalhando as chegadas: 20 gravacoes
    // simultaneas disputam a mesma janela e so uma entra (a trava do evento serializa).
    const evento = c.eventoDe(ana.email);
    await prisma.campaignLinkHit.deleteMany({ where: { campaignEventId: evento } });
    const agora = new Date();
    const limite = new Date(agora.getTime() - JANELA_ABERTURA_MS);
    const gravadas = await Promise.all(
      Array.from({ length: 20 }, () => repo.registrarAbertura(evento, { ip: null, userAgent: null }, agora, limite, TETO_ABERTURAS_POR_EVENTO)),
    );
    assert.equal(gravadas.filter(Boolean).length, 1);
    assert.equal(await linhasDe(evento), 1);
  });

  it('abertura de 31 min atrás + nova requisição = 2 aberturas e possível repasse', async () => {
    const c = await campanhaCom(ana);
    const evento = c.eventoDe(ana.email);
    await prisma.campaignLinkHit.create({ data: { campaignEventId: evento, registradoEm: new Date(Date.now() - 31 * MIN_MS) } });
    assert.equal((await abrir(c.tokens[0])).status, 200);
    assert.equal(await linhasDe(evento), 2);
    const deAna = await deAnaNo(c.id);
    assert.equal(deAna.aberturas, 2);
    assert.equal(deAna.possivelRepasse, true);
  });

  it('abertura de 29 min atrás + nova requisição continua 1 (dentro da janela)', async () => {
    const c = await campanhaCom(ana);
    const evento = c.eventoDe(ana.email);
    await prisma.campaignLinkHit.create({ data: { campaignEventId: evento, registradoEm: new Date(Date.now() - 29 * MIN_MS) } });
    assert.equal((await abrir(c.tokens[0])).status, 200);
    assert.equal(await linhasDe(evento), 1);
  });

  it('teto: 50 linhas antigas + nova requisição continua 50, e o link responde igual', async () => {
    const c = await campanhaCom(ana);
    const evento = c.eventoDe(ana.email);
    const referencia = (await abrir(c.tokens[0])).body.dados;
    await prisma.campaignLinkHit.deleteMany({ where: { campaignEventId: evento } });
    await prisma.campaignLinkHit.createMany({
      data: Array.from({ length: TETO_ABERTURAS_POR_EVENTO }, (_, i) => ({
        campaignEventId: evento,
        registradoEm: new Date(Date.now() - (i + 1) * DIA_MS),
      })),
    });
    respostaIgual(await abrir(c.tokens[0]), referencia);
    assert.equal(await linhasDe(evento), TETO_ABERTURAS_POR_EVENTO);
    assert.equal((await relatorio(c.id)).resumo.aberturas, TETO_ABERTURAS_POR_EVENTO, 'a contagem para em 50');
  });
});

describe('IP e user-agent nunca saem pela API', () => {
  it('nem na abertura do link nem no relatório nem na lista de campanhas', async () => {
    const c = await campanhaCom(ana);
    const ua = 'AgenteUnicoQueNaoPodeVazar/9.9';
    const aberto = await abrir(c.tokens[0], ua);
    const [linha] = await prisma.campaignLinkHit.findMany({ where: { campaignEventId: c.eventoDe(ana.email) } });
    const corpos = [
      JSON.stringify(aberto.body),
      JSON.stringify((await chamar('GET', `/campanhas/${c.id}`, { token: analista })).body),
      JSON.stringify((await chamar('GET', '/campanhas', { token: analista })).body),
      JSON.stringify((await chamar('GET', '/treinamentos/consolidado', { token: analista })).body),
    ];
    for (const corpo of corpos) {
      assert.ok(!corpo.includes(ua), 'user-agent vazou');
      assert.ok(!corpo.includes(linha.ip!), 'IP vazou');
      assert.ok(!/"ip"|"userAgent"/.test(corpo), 'campo ip/userAgent na resposta');
    }
  });
});

describe(`retenção LGPD de ${RETENCAO_DADOS_ABERTURA_DIAS} dias`, () => {
  it('a abertura anula IP/user-agent das aberturas com 91 dias, mantém as de 89 e não apaga linha', async () => {
    assert.equal(RETENCAO_DADOS_ABERTURA_DIAS, 90);
    const c = await campanhaCom(ana, bruno);
    const evento = c.eventoDe(bruno.email);
    const velha = await prisma.campaignLinkHit.create({
      data: { campaignEventId: evento, ip: '198.51.100.9', userAgent: 'antigo', registradoEm: new Date(Date.now() - 91 * DIA_MS) },
    });
    const recente = await prisma.campaignLinkHit.create({
      data: { campaignEventId: evento, ip: '203.0.113.7', userAgent: 'recente', registradoEm: new Date(Date.now() - 89 * DIA_MS) },
    });
    const total = await prisma.campaignLinkHit.count();

    // Abertura de OUTRA pessoa dispara o expurgo de todas (sem cron).
    assert.equal((await abrir(c.tokens[0])).status, 200);

    const v = await prisma.campaignLinkHit.findUniqueOrThrow({ where: { id: velha.id } });
    const r = await prisma.campaignLinkHit.findUniqueOrThrow({ where: { id: recente.id } });
    assert.equal(v.ip, null);
    assert.equal(v.userAgent, null);
    assert.equal(r.ip, '203.0.113.7');
    assert.equal(r.userAgent, 'recente');
    assert.equal(await prisma.campaignLinkHit.count(), total + 1, 'nenhuma linha apagada; só a nova entrou');
    // A abertura anonimizada continua contando no relatorio.
    assert.equal(await prisma.campaignLinkHit.count({ where: { campaignEventId: evento } }), 2);
  });
});

describe('falha ao gravar a abertura não derruba o link', () => {
  it('com o INSERT e o UPDATE em CampaignLinkHit recusados, o treinamento abre e o clique é registrado', async () => {
    const c = await campanhaCom(ana);
    // Simula a tabela indisponivel so neste banco isolado de teste.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION teste_recusa_abertura() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'abertura recusada pelo teste'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER teste_recusa_abertura BEFORE INSERT OR UPDATE ON "CampaignLinkHit"
      FOR EACH ROW EXECUTE FUNCTION teste_recusa_abertura()`);
    // Linha velha para o expurgo ter o que atualizar (e falhar tambem).
    await prisma.$executeRawUnsafe(`ALTER TABLE "CampaignLinkHit" DISABLE TRIGGER teste_recusa_abertura`);
    await prisma.campaignLinkHit.create({
      data: { campaignEventId: c.eventoDe(ana.email), ip: '192.0.2.10', registradoEm: new Date(Date.now() - 120 * DIA_MS) },
    });
    await prisma.$executeRawUnsafe(`ALTER TABLE "CampaignLinkHit" ENABLE TRIGGER teste_recusa_abertura`);

    const erroOriginal = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => void logs.push(args.map(String).join(' '));
    try {
      const r = await abrir(c.tokens[0]);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.status, 'sucesso');
      assert.ok(r.body.dados.titulo, 'o treinamento chega ao usuário');
    } finally {
      console.error = erroOriginal;
      await prisma.$executeRawUnsafe('DROP TRIGGER teste_recusa_abertura ON "CampaignLinkHit"');
      await prisma.$executeRawUnsafe('DROP FUNCTION teste_recusa_abertura()');
    }

    const ev = await prisma.campaignEvent.findUniqueOrThrow({ where: { id: c.eventoDe(ana.email) } });
    assert.ok(ev.clicadoEm, 'o clique do funil foi registrado');
    assert.equal(await prisma.campaignLinkHit.count({ where: { campaignEventId: ev.id } }), 1, 'só a linha antiga');
    assert.ok(logs.some((l) => l.includes('contagem de aberturas do link: abertura não registrada')), 'a falha do INSERT vai para o log');
    assert.ok(logs.some((l) => l.includes('contagem de aberturas do link: retenção de IP/user-agent falhou')), 'a falha do expurgo vai para o log');
  });
});
