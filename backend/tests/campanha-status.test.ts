// DT34: o status da campanha e derivado na leitura (statusEfetivo, models/campanha.model.ts).
// A API so grava AGENDADA; com pelo menos um e-mail enviado a campanha e ATIVA, e ENCERRADA
// gravada (hoje so pelo seed-demo) e respeitada. Vale para GET /campanhas (lista e resumo
// `ativas`), GET /campanhas/:id e GET /dashboard. POST /campaigns (contrato N2 AT1) segue
// respondendo o status gravado. Banco isolado (helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, chamar, criarUsuario, encerrarServidor, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let analista = '';
let pessoas: { id: string; email: string }[] = [];
const ids = { ativa: '', agendada: '', encerrada: '' };

before(async () => {
  await iniciarServidor(app);
  const admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  pessoas = await Promise.all(['st-1', 'st-2', 'st-3'].map((s) => criarUsuario(admin, 'Colaborador', s)));
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

async function listar() {
  const r = await chamar('GET', '/campanhas', { token: analista });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as { dados: { id: string; status: string; enviados: number }[]; resumo: { ativas: number } };
}

const statusNaLista = async (id: string) => (await listar()).dados.find((c) => c.id === id)?.status;

async function statusNoDetalhe(id: string) {
  const r = await chamar('GET', `/campanhas/${id}`, { token: analista });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados.status as string;
}

describe('status efetivo da campanha (DT34)', () => {
  it('com envio: POST /campaigns responde AGENDADA (contrato), a leitura mostra ATIVA', async () => {
    const r = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Status ativa', destinatarios: [pessoas[0].email, pessoas[1].email], template: 'urgencia' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.status, 'AGENDADA', 'o contrato N2 AT1 não muda');
    assert.equal(r.body.dados.emailsEnviados, 2);
    ids.ativa = r.body.dados.idCampanha;

    const gravada = await prisma.campaign.findUniqueOrThrow({ where: { id: ids.ativa } });
    assert.equal(gravada.status, 'AGENDADA', 'nada é gravado: o status é derivado na leitura');
    assert.equal(await statusNaLista(ids.ativa), 'ATIVA');
    assert.equal(await statusNoDetalhe(ids.ativa), 'ATIVA');
  });

  it('sem nenhum envio: AGENDADA na lista e no detalhe', async () => {
    const c = await prisma.campaign.create({
      data: {
        nome: 'Status agendada', template: 'autoridade', status: 'AGENDADA',
        eventos: { create: [{ userId: pessoas[2].id, destinatario: pessoas[2].email }] },
      },
    });
    ids.agendada = c.id;
    assert.equal(await statusNaLista(c.id), 'AGENDADA');
    assert.equal(await statusNoDetalhe(c.id), 'AGENDADA');
  });

  it('ENCERRADA gravada com envios continua ENCERRADA', async () => {
    const agora = new Date();
    const c = await prisma.campaign.create({
      data: {
        nome: 'Status encerrada', template: 'curiosidade', status: 'ENCERRADA',
        eventos: { create: pessoas.map((p) => ({ userId: p.id, destinatario: p.email, enviadoEm: agora })) },
      },
    });
    ids.encerrada = c.id;
    assert.equal(await statusNaLista(c.id), 'ENCERRADA');
    assert.equal(await statusNoDetalhe(c.id), 'ENCERRADA');
  });

  it('resumo.ativas conta só as campanhas com status efetivo ATIVA', async () => {
    const { dados, resumo } = await listar();
    assert.equal(resumo.ativas, dados.filter((c) => c.status === 'ATIVA').length);
    assert.equal(resumo.ativas, 1, 'só a campanha com envio (a agendada e a encerrada não contam)');
  });

  it('o dashboard escolhe a campanha ativa, não a mais recente', async () => {
    const { dados } = await listar();
    assert.notEqual(dados[0].id, ids.ativa, 'a ativa não é a primeira da lista (o fallback daria outra)');
    const r = await chamar('GET', '/dashboard', { token: analista });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dados.campanhaAtiva, 'Status ativa');
    assert.equal(r.body.dados.funil.enviados.valor, 2);
    const doDashboard = (r.body.dados.campanhas as { id: string; status: string }[]).map((c) => [c.id, c.status]);
    assert.deepEqual(
      Object.fromEntries(doDashboard.filter(([id]) => Object.values(ids).includes(id))),
      { [ids.ativa]: 'ATIVA', [ids.agendada]: 'AGENDADA', [ids.encerrada]: 'ENCERRADA' },
    );
  });
});
