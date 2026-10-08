// B25b — historico de status do achado em tabela propria (FindingStatusChange):
// - a mudanca de status grava o evento na MESMA transacao do update (falhou o evento, o status
//   nao muda nem vai para a auditoria);
// - a aba de historico le a tabela (deteccao = evento de criacao; mudancas com autor);
// - o aviso de incompleto so aparece quando a cadeia nao explica o status atual;
// - a lista e o PDF continuam iguais (o historico nao vaza para eles).
// A criacao pelo ciclo da varredura e pelo cruzamento do B14 e conferida em varredura.test.ts e
// cruzamento.test.ts. Banco Postgres isolado (baluarte_test_historico_status) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, baixar, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';
import { textoDoPdf } from './pdf.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');

let analista: string;
let admin: string;
let analistaId: string;
let adminId: string;
let scanId: string;
const achado: Record<string, string> = {};

type Evento = { tipo: string; quando: string; de?: string; para?: string; autor?: { id: string; nome: string } | null };
type Detalhe = { status: string; historico: { eventos: Evento[]; statusAtual: string; completo: boolean } };

before(async () => {
  await iniciarServidor(app);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  admin = await login(ADMIN.email, ADMIN.senha);
  analistaId = (await prisma.user.findUniqueOrThrow({ where: { email: ANALISTA.email } })).id;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } })).id;

  const ativo = await prisma.asset.create({ data: { nome: 'Portal Hist', host: '10.26.0.1', tipo: 'Aplicacao' } });
  const detectadoEm = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const scan = await prisma.scan.create({ data: { assetId: ativo.id, status: 'CONCLUIDA', criadoEm: detectadoEm, concluidoEm: detectadoEm } });
  scanId = scan.id;
  // Como a API cria: achado "Aberta" + evento de criacao no instante do achado.
  for (const [apelido, chave] of [['sql', 'injecao-sql'], ['idor', 'idor'], ['cors', 'cors-curinga'], ['falha', 'controle-acesso']] as const) {
    const f = await prisma.finding.create({ data: { ...dadosAchado(chave), scanId, criadoEm: detectadoEm } });
    await prisma.findingStatusChange.create({ data: { findingId: f.id, de: null, para: 'Aberta', registradaEm: detectadoEm } });
    achado[apelido] = f.id;
  }
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

async function detalhe(id: string): Promise<Detalhe> {
  const r = await chamar('GET', `/vulnerabilidades/${id}`, { token: analista });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as Detalhe;
}

async function alterar(id: string, status: string, token = analista) {
  const r = await chamar('PATCH', `/vulnerabilidades/${id}`, { token, body: { status } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as Detalhe;
}

const eventosDe = (findingId: string) =>
  prisma.findingStatusChange.findMany({ where: { findingId }, orderBy: [{ registradaEm: 'asc' }, { id: 'asc' }] });

describe('mudança de status grava o histórico (mesma transação)', () => {
  it('cada mudança vira um evento com de, para e autor; repetir o status não grava nada', async () => {
    await alterar(achado.sql, 'Em revisão');
    await alterar(achado.sql, 'Em revisão');
    await alterar(achado.sql, 'Resolvida', admin);
    const eventos = await eventosDe(achado.sql);
    assert.deepEqual(
      eventos.map((e) => [e.de, e.para, e.usuarioId]),
      [[null, 'Aberta', null], ['Aberta', 'Em revisão', analistaId], ['Em revisão', 'Resolvida', adminId]],
    );
    // A auditoria continua registrando (RN-008), com o mesmo texto de antes.
    const trilha = await prisma.auditLog.findMany({ where: { acao: 'ALTERAR_STATUS_VULNERABILIDADE', detalhe: { startsWith: `${achado.sql} (` } } });
    assert.equal(trilha.length, 2);
    assert.match(trilha[0].detalhe!, / \(10\.26\.0\.1, A03:2021 - Injection\): (Aberta → Em revisão|Em revisão → Resolvida)$/);
  });

  it('se o evento não puder ser gravado, o status não muda e nada vai para a auditoria (rollback)', async () => {
    const id = achado.falha;
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION falha_historico_teste() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falha simulada no historico'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER falha_historico_teste BEFORE INSERT ON "FindingStatusChange" FOR EACH ROW
       WHEN (NEW."findingId" = '${id}') EXECUTE FUNCTION falha_historico_teste()`,
    );
    try {
      const r = await chamar('PATCH', `/vulnerabilidades/${id}`, { token: analista, body: { status: 'Resolvida' } });
      esperaErro(r, 500, 'ERRO_INTERNO');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER falha_historico_teste ON "FindingStatusChange"');
      await prisma.$executeRawUnsafe('DROP FUNCTION falha_historico_teste()');
    }
    assert.equal((await prisma.finding.findUniqueOrThrow({ where: { id } })).status, 'Aberta', 'o update foi desfeito');
    assert.equal((await eventosDe(id)).length, 1, 'só o evento de criação');
    assert.equal(await prisma.auditLog.count({ where: { detalhe: { startsWith: `${id} (` } } }), 0);

    // Sem a falha, a mesma mudança passa normalmente.
    await alterar(id, 'Resolvida');
    assert.deepEqual((await eventosDe(id)).map((e) => e.para), ['Aberta', 'Resolvida']);
  });

  it('mudanças simultâneas no mesmo achado formam uma cadeia sem buraco (linha travada)', async () => {
    const id = achado.cors;
    const alvos = ['Em revisão', 'Em remediação', 'Risco aceito', 'Resolvida'];
    const respostas = await Promise.all(alvos.map((status) => chamar('PATCH', `/vulnerabilidades/${id}`, { token: analista, body: { status } })));
    assert.ok(respostas.every((r) => r.status === 200));
    const eventos = await eventosDe(id);
    const mudancas = eventos.filter((e) => e.de !== null);
    assert.equal(mudancas.length, alvos.length);
    let status = 'Aberta';
    for (const m of mudancas) {
      assert.equal(m.de, status, 'cada evento sai de onde o anterior parou');
      status = m.para;
    }
    assert.equal((await prisma.finding.findUniqueOrThrow({ where: { id } })).status, status);
    assert.equal((await detalhe(id)).historico.completo, true);
  });

  it('achado inexistente: 404 e nenhum evento', async () => {
    const r = await chamar('PATCH', '/vulnerabilidades/nao-existe', { token: analista, body: { status: 'Resolvida' } });
    esperaErro(r, 404, 'FINDING_NAO_ENCONTRADO');
    assert.equal(await prisma.findingStatusChange.count({ where: { findingId: 'nao-existe' } }), 0);
  });
});

describe('aba de histórico lendo a tabela', () => {
  it('a detecção é o evento de criação; as mudanças vêm com autor; a resposta do PATCH já traz a nova', async () => {
    const depois = await alterar(achado.idor, 'Em remediação');
    assert.deepEqual(depois.historico.eventos.map((e) => e.tipo), ['DETECTADO', 'STATUS_ALTERADO']);
    const d = await detalhe(achado.idor);
    const [deteccao, mudanca] = d.historico.eventos;
    const criacao = (await eventosDe(achado.idor))[0];
    assert.equal(new Date(deteccao.quando).getTime(), criacao.registradaEm.getTime());
    assert.deepEqual([mudanca.de, mudanca.para, mudanca.autor], ['Aberta', 'Em remediação', { id: analistaId, nome: 'Analista de Segurança' }]);
    assert.equal(d.historico.statusAtual, 'Em remediação');
    assert.equal(d.historico.completo, true);
  });

  it('o aviso só aparece quando a cadeia não explica o status atual', async () => {
    // Status mudado por fora da API (sem evento): a cadeia para em "Em remediação".
    await prisma.finding.update({ where: { id: achado.idor }, data: { status: 'Resolvida' } });
    let d = await detalhe(achado.idor);
    assert.equal(d.historico.completo, false);
    assert.equal(d.historico.eventos.length, 2, 'não inventa a mudança que faltou');
    // Registrada a mudança que faltava, a cadeia volta a explicar o status: sem aviso.
    await prisma.findingStatusChange.create({ data: { findingId: achado.idor, de: 'Em remediação', para: 'Resolvida', usuarioId: 'conta-excluida' } });
    d = await detalhe(achado.idor);
    assert.equal(d.historico.completo, true);
    assert.equal(d.historico.eventos.at(-1)!.autor, null, 'autor que não existe mais sai como null');
  });

  it('o banco recusa evento fora das regras (CHECK): status desconhecido, de = para, criação que não é "Aberta"', async () => {
    const recusa = (data: { de: string | null; para: string }) =>
      assert.rejects(prisma.findingStatusChange.create({ data: { findingId: achado.idor, ...data } }));
    await recusa({ de: 'Aberta', para: 'Fechada' });
    await recusa({ de: 'Fechada', para: 'Aberta' });
    await recusa({ de: 'Aberta', para: 'Aberta' });
    await recusa({ de: null, para: 'Resolvida' });
  });

  it('excluir o achado leva o histórico junto (cascade)', async () => {
    const f = await prisma.finding.create({ data: { ...dadosAchado('idor'), scanId } });
    await prisma.findingStatusChange.create({ data: { findingId: f.id, de: null, para: 'Aberta' } });
    await prisma.finding.delete({ where: { id: f.id } });
    assert.equal(await prisma.findingStatusChange.count({ where: { findingId: f.id } }), 0);
  });
});

describe('a lista e o PDF continuam iguais', () => {
  /** O PDF sem a hora de geração (o resto é estável entre duas exportações). */
  const textoEstavel = (pdf: Buffer) => textoDoPdf(pdf).replace(/\d{2}:\d{2}(:\d{2})?/g, '');

  it('eventos de histórico não mudam a lista nem o relatório; a lista não traz histórico', async () => {
    const listaAntes = await chamar('GET', '/vulnerabilidades?q=10.26.0.1', { token: analista });
    const pdfAntes = await baixar('/vulnerabilidades/relatorio.pdf?q=10.26.0.1', analista);
    assert.equal(pdfAntes.status, 200);

    // Histórico novo sem mudar status nenhum (ex.: preenchimento pela migration).
    const f = await prisma.finding.findUniqueOrThrow({ where: { id: achado.sql } });
    await prisma.findingStatusChange.createMany({
      data: [
        { findingId: f.id, de: 'Resolvida', para: 'Em revisão', usuarioId: analistaId },
        { findingId: f.id, de: 'Em revisão', para: 'Resolvida', usuarioId: analistaId },
      ],
    });

    const listaDepois = await chamar('GET', '/vulnerabilidades?q=10.26.0.1', { token: analista });
    assert.deepEqual(listaDepois.body, listaAntes.body);
    const item = listaDepois.body.dados[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(item).sort(), [
      'ativo', 'ativoNome', 'baseVulnerabilidade', 'categoria', 'cve', 'cvss', 'cvssVetor', 'cwe', 'descricao',
      'detectadoEm', 'evidencia', 'id', 'programa', 'programaVersao', 'remediacao', 'severidade', 'status',
    ]);
    const pdfDepois = await baixar('/vulnerabilidades/relatorio.pdf?q=10.26.0.1', analista);
    assert.equal(textoEstavel(pdfDepois.corpo), textoEstavel(pdfAntes.corpo));
  });
});
