// B19: e-mail simulado da campanha de phishing. POST /campaigns envia a cada destinatario
// o e-mail do template com o link rastreavel (/t/<token>) e o de reporte
// (/t/<token>/reportar); o token do e-mail abre o treinamento e registra o reporte
// (POST /treinamentos/link/:token/reportar, publico e idempotente). Banco isolado (helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ADMIN,
  ANALISTA,
  chamar,
  criarUsuario,
  encerrarServidor,
  esperaErro,
  iniciarServidor,
  login,
  prepararBanco,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { caixaDeSaida } = await import('../src/config/email.js');
const { hashToken } = await import('../src/utils/tokens.js');

const FRONTEND = 'http://localhost:5173';
const LINK = new RegExp(`${FRONTEND}/t/([0-9a-f]{64})(?!/)`);
const LINK_REPORTE = new RegExp(`${FRONTEND}/t/([0-9a-f]{64})/reportar`);

let admin = '';
let analista = '';
let ana: { id: string; email: string };
let bruno: { id: string; email: string };

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  ana = await criarUsuario(admin, 'Colaborador', 'ana');
  bruno = await criarUsuario(admin, 'Colaborador', 'bruno');
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** E-mails da campanha (os de convite tambem caem na caixa) enviados a partir de `desde`. */
function emailsDeCampanha(desde: number) {
  return caixaDeSaida.slice(desde).filter((e) => LINK.test(e.texto));
}

function tokenDe(texto: string): string {
  const m = texto.match(LINK);
  assert.ok(m, `esperava o link /t/<token> no e-mail:\n${texto}`);
  return m[1];
}

async function criarCampanha(template: string, destinatarios: string[]) {
  const desde = caixaDeSaida.length;
  const r = await chamar('POST', '/campaigns', { token: analista, body: { nome: `Campanha ${template}`, destinatarios, template } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { r, emails: emailsDeCampanha(desde) };
}

// -----------------------------------------------------------------------------

describe('POST /campaigns envia o e-mail simulado', () => {
  it('um e-mail por destinatário, com o link rastreável certo e o token que está (como hash) no evento', async () => {
    const { r, emails } = await criarCampanha('urgencia', [ana.email, bruno.email]);
    // Contrato inalterado + campo novo.
    assert.equal(r.body.mensagem, 'Campanha criada com sucesso');
    assert.equal(r.body.dados.status, 'AGENDADA');
    assert.equal(r.body.dados.emailsEnviados, 2);
    assert.ok(!JSON.stringify(r.body).includes('/t/'), 'a resposta não pode carregar o link');

    assert.deepEqual(emails.map((e) => e.para).sort(), [ana.email, bruno.email].sort());
    const eventos = await prisma.campaignEvent.findMany({ where: { campaignId: r.body.dados.idCampanha } });
    for (const email of emails) {
      const token = tokenDe(email.texto);
      const evento = eventos.find((e) => e.destinatario === email.para);
      assert.equal(evento?.tokenHash, hashToken(token), 'o token do e-mail é o do evento do destinatário');
      assert.ok(evento?.enviadoEm, 'enviadoEm marcado para quem recebeu');
      assert.equal(email.texto.match(LINK_REPORTE)?.[1], token, 'o link de reporte usa o mesmo token');
    }
    assert.notEqual(tokenDe(emails[0].texto), tokenDe(emails[1].texto));

    // O funil do relatório passa a contar os enviados.
    const rel = await chamar('GET', `/campanhas/${r.body.dados.idCampanha}`, { token: analista });
    assert.equal(rel.body.dados.funil.enviados.valor, 2);
  });

  it('o texto segue o template, é identificado como simulação, não pede senha e não tem link externo', async () => {
    const assuntos = new Set<string>();
    for (const template of ['urgencia', 'autoridade', 'curiosidade']) {
      const { emails } = await criarCampanha(template, [ana.email]);
      assert.equal(emails.length, 1);
      const [email] = emails;
      assuntos.add(email.assunto);
      assert.match(email.texto, /SIMULAÇÃO DE PHISHING/);
      assert.match(email.texto, /plataforma Baluarte/);
      assert.match(email.texto, /Reporte aqui:/);
      assert.match(email.texto, /Usuário ana/, 'saudação com o nome do destinatário');
      assert.doesNotMatch(email.texto, /digite sua senha|informe sua senha/i);
      const urls = email.texto.match(/https?:\/\/\S+/g) ?? [];
      assert.equal(urls.length, 2);
      for (const url of urls) assert.ok(url.startsWith(`${FRONTEND}/t/`), `link externo: ${url}`);
    }
    assert.equal(assuntos.size, 3, 'cada template tem o seu assunto');
    assert.ok([...assuntos].some((a) => /24 horas/.test(a)));
    assert.ok([...assuntos].some((a) => /Diretoria/.test(a)));
    assert.ok([...assuntos].some((a) => /cargos e salários/.test(a)));
  });

  it('nada é enviado quando algum destinatário é rejeitado', async () => {
    const admin2 = await login(ADMIN.email, ADMIN.senha);
    const inativo = await criarUsuario(admin2, 'Colaborador', 'inativo');
    assert.equal((await chamar('PATCH', `/users/${inativo.id}`, { token: admin2, body: { status: 'Inativo' } })).status, 200);
    const antes = caixaDeSaida.length;
    const eventosAntes = await prisma.campaignEvent.count();

    const casos: [unknown, number, string][] = [
      [[ana.email, 'ninguem@empresa.com'], 422, 'DESTINATARIO_NAO_CADASTRADO'],
      [[ana.email, inativo.email], 422, 'DESTINATARIO_NAO_CADASTRADO'],
      [[ana.email, 'fora@gmail.com'], 422, 'DESTINATARIO_EXTERNO'],
      [[ana.email, 'quebrado'], 400, 'EMAIL_INVALIDO'],
    ];
    for (const [destinatarios, status, codigo] of casos) {
      esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatarios, template: 'urgencia' } }), status, codigo);
    }
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: ana.email, template: '' } }), 400, 'TEMPLATE_OBRIGATORIO');
    assert.equal(caixaDeSaida.length, antes, 'nenhum e-mail sai de campanha recusada');
    assert.equal(await prisma.campaignEvent.count(), eventosAntes);
  });

  it('o domínio interno vem de DOMINIO_INTERNO (padrão @empresa.com) — B10', async () => {
    const original = process.env.DOMINIO_INTERNO;
    try {
      process.env.DOMINIO_INTERNO = 'Filial.Exemplo.com.br'; // sem '@' e com maiúsculas: normalizado
      const email = `dest.${Date.now()}@filial.exemplo.com.br`;
      const criado = await chamar('POST', '/users', { token: admin, body: { nome: 'Destino Filial', email, perfil: 'Colaborador' } });
      assert.equal(criado.status, 201, JSON.stringify(criado.body));

      const ok = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Filial', destinatario: email, template: 'urgencia' } });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      // Com o domínio trocado, o @empresa.com passa a ser externo (mesma mensagem e código do contrato).
      const fora = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: ana.email, template: 'urgencia' } });
      esperaErro(fora, 422, 'DESTINATARIO_EXTERNO');
      assert.equal(fora.body.mensagem, 'Destinatário não autorizado: apenas e-mails internos');
      // Domínio certo, mas sem cadastro: continua barrado.
      esperaErro(
        await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: 'ninguem@filial.exemplo.com.br', template: 'urgencia' } }),
        422,
        'DESTINATARIO_NAO_CADASTRADO',
      );

      // Vazio = padrão do contrato.
      process.env.DOMINIO_INTERNO = '  ';
      const padrao = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Padrão', destinatario: ana.email, template: 'urgencia' } });
      assert.equal(padrao.status, 201, JSON.stringify(padrao.body));
      esperaErro(
        await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: email, template: 'urgencia' } }),
        422,
        'DESTINATARIO_EXTERNO',
      );
    } finally {
      if (original === undefined) delete process.env.DOMINIO_INTERNO;
      else process.env.DOMINIO_INTERNO = original;
    }
  });

  it('registra a criação e o envio na auditoria', async () => {
    const { r } = await criarCampanha('curiosidade', [bruno.email]);
    const id = r.body.dados.idCampanha as string;
    const logs = await prisma.auditLog.findMany({ where: { detalhe: { contains: id } } });
    assert.deepEqual(logs.map((l) => l.acao).sort(), ['CRIAR_CAMPANHA', 'ENVIAR_CAMPANHA']);
    assert.match(logs.find((l) => l.acao === 'ENVIAR_CAMPANHA')!.detalhe!, /1 de 1/);
  });

  it('em produção sem SMTP nada é enviado nem impresso, e a campanha é criada mesmo assim', async () => {
    const antes = caixaDeSaida.length;
    const impresso: string[] = [];
    const log = console.log;
    const logErro = console.error;
    console.log = (...a: unknown[]) => void impresso.push(a.join(' '));
    console.error = (...a: unknown[]) => void impresso.push(a.join(' '));
    process.env.NODE_ENV = 'production';
    let r;
    try {
      r = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Sem SMTP', destinatario: ana.email, template: 'urgencia' } });
    } finally {
      process.env.NODE_ENV = 'test';
      console.log = log;
      console.error = logErro;
    }
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.status, 'AGENDADA');
    assert.equal(r.body.dados.emailsEnviados, 0);
    assert.equal(caixaDeSaida.length, antes);
    assert.ok(!impresso.some((l) => /\/t\/[0-9a-f]{64}/.test(l)), `o link não pode ir para o log: ${impresso.join('\n')}`);
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: r.body.dados.idCampanha } });
    assert.equal(evento.enviadoEm, null, 'sem envio, sem enviadoEm');
  });
});

describe('link e reporte pelo token do e-mail', () => {
  let tokenAna = '';
  let tokenBruno = '';
  let idCampanha = '';

  before(async () => {
    const { r, emails } = await criarCampanha('autoridade', [ana.email, bruno.email]);
    idCampanha = r.body.dados.idCampanha;
    tokenAna = tokenDe(emails.find((e) => e.para === ana.email)!.texto);
    tokenBruno = tokenDe(emails.find((e) => e.para === bruno.email)!.texto);
  });

  it('o link do e-mail abre o treinamento do template e registra o clique', async () => {
    const r = await chamar('GET', `/treinamentos/link/${tokenAna}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.template, 'autoridade');
    assert.equal(r.body.dados.tipoAtaque, 'Phishing por Autoridade');
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: idCampanha, userId: ana.id } });
    assert.ok(evento.clicadoEm && evento.abertoEm);
    assert.equal((await chamar('POST', `/treinamentos/link/${tokenAna}/concluir`)).status, 200);
  });

  it('reportar registra o reporte (e a abertura) sem registrar clique, e é idempotente', async () => {
    const r = await chamar('POST', `/treinamentos/link/${tokenBruno}/reportar`);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'sucesso');
    assert.equal(r.body.dados.reportado, true);
    assert.ok(r.body.dados.reportadoEm);
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: idCampanha, userId: bruno.id } });
    assert.ok(evento.reportouEm && evento.abertoEm);
    assert.equal(evento.clicadoEm, null, 'reportar não é clicar');

    await sleep(5);
    const denovo = await chamar('POST', `/treinamentos/link/${tokenBruno}/reportar`);
    assert.equal(denovo.status, 200);
    assert.equal(denovo.body.dados.reportadoEm, r.body.dados.reportadoEm, 'o primeiro reporte vale');
    const logs = await prisma.auditLog.count({ where: { acao: 'REPORTAR_PHISHING', usuarioId: bruno.id } });
    assert.equal(logs, 1, 'um registro de auditoria só');
  });

  it('quem clicou também pode reportar; o relatório da campanha mostra os reportes', async () => {
    assert.equal((await chamar('POST', `/treinamentos/link/${tokenAna}/reportar`)).status, 200);
    const rel = await chamar('GET', `/campanhas/${idCampanha}`, { token: analista });
    assert.equal(rel.status, 200);
    assert.equal(rel.body.dados.funil.reportaram.valor, 2);
    assert.equal(rel.body.dados.funil.reportaram.pct, 100);
    const reportes = rel.body.dados.reportes as { destinatario: string; clicou: boolean; reportouEm: string }[];
    assert.deepEqual(reportes.map((x) => x.destinatario), [bruno.email, ana.email], 'em ordem de reporte');
    assert.deepEqual(reportes.map((x) => x.clicou), [false, true]);
    const treino = rel.body.dados.treinamentos.find((t: { destinatario: string }) => t.destinatario === ana.email);
    assert.ok(treino.reportouEm);
  });

  it('token inválido, ou o id do evento no lugar do token, dá 404', async () => {
    esperaErro(await chamar('POST', `/treinamentos/link/${'c'.repeat(64)}/reportar`), 404, 'LINK_NAO_ENCONTRADO');
    esperaErro(await chamar('POST', '/treinamentos/link/nao-existe/reportar'), 404, 'LINK_NAO_ENCONTRADO');
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: idCampanha } });
    esperaErro(await chamar('POST', `/treinamentos/link/${evento.id}/reportar`), 404, 'LINK_NAO_ENCONTRADO');
    esperaErro(await chamar('GET', `/treinamentos/link/${'c'.repeat(64)}`), 404, 'TREINAMENTO_NAO_ENCONTRADO');
  });

  it('GET no endereço de reporte não registra nada (só o POST confirmado)', async () => {
    const { emails } = await criarCampanha('curiosidade', [ana.email]);
    const token = tokenDe(emails[0].texto);
    const r = await chamar('GET', `/treinamentos/link/${token}/reportar`);
    assert.equal(r.status, 404);
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
    assert.equal(evento.reportouEm, null);
  });
});
