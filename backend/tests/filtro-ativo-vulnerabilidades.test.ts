// Melhorias #16 — filtro por ativo na lista de vulnerabilidades:
// GET /vulnerabilidades?ativoId= (aditivo; filtra no banco), combinado com severidade, status,
// busca, ordem e paginacao, com o resumo do filtro inteiro; o mesmo filtro no PDF do B24.
// `ativoId` fora do formato: 400 ATIVO_ID_INVALIDO; ativo inexistente: 404 ATIVO_NAO_ENCONTRADO
// (nunca uma lista vazia que diria "ativo sem achados").
// Banco Postgres isolado (baluarte_test_filtro_ativo_vulnerabilidades) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ANALISTA, baixar, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';
import { textoDoPdf } from './pdf.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');

let analista: string;
let colaborador: string;
/** Ativo com 25 achados (pagina de verdade), outro com 3 e um sem achados. */
let grande = '';
let pequeno = '';
let vazio = '';

before(async () => {
  await iniciarServidor(app);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');

  const concluida = { status: 'CONCLUIDA', concluidoEm: new Date() };
  const criar = async (nome: string, host: string) => (await prisma.asset.create({ data: { nome, host, tipo: 'Aplicacao' } })).id;
  grande = await criar('Portal Grande', '10.16.0.1');
  pequeno = await criar('Banco Pequeno', '10.16.0.2');
  vazio = await criar('Ativo Sem Achados', '10.16.0.3');

  // Duas varreduras no ativo grande: o filtro pega os achados de todas as varreduras dele.
  const g1 = await prisma.scan.create({ data: { assetId: grande, ...concluida } });
  const g2 = await prisma.scan.create({ data: { assetId: grande, ...concluida } });
  const p1 = await prisma.scan.create({ data: { assetId: pequeno, ...concluida } });
  const base = Date.parse('2026-10-01T12:00:00Z');
  const em = (i: number) => new Date(base + i * 60_000);
  await prisma.finding.createMany({
    data: [
      // Ativo grande: 10 Críticos abertos (injeção SQL), 10 Médios abertos (IDOR), 5 Médios resolvidos.
      ...Array.from({ length: 10 }, (_, i) => ({ ...dadosAchado('injecao-sql'), scanId: g1.id, status: 'Aberta', criadoEm: em(i) })),
      ...Array.from({ length: 10 }, (_, i) => ({ ...dadosAchado('idor'), scanId: g2.id, status: 'Aberta', criadoEm: em(10 + i) })),
      ...Array.from({ length: 5 }, (_, i) => ({ ...dadosAchado('idor'), scanId: g2.id, status: 'Resolvida', criadoEm: em(20 + i) })),
      // Ativo pequeno: o mesmo tipo de achado (a busca por categoria casaria os dois ativos).
      { ...dadosAchado('injecao-sql'), scanId: p1.id, status: 'Aberta', criadoEm: em(30) },
      { ...dadosAchado('idor'), scanId: p1.id, status: 'Resolvida', criadoEm: em(31) },
      { ...dadosAchado('cors-curinga'), scanId: p1.id, status: 'Aberta', criadoEm: em(32) },
    ],
  });
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

async function listar(query: string) {
  const r = await chamar('GET', `/vulnerabilidades${query}`, { token: analista });
  assert.equal(r.status, 200, `esperava 200 para ${query}, veio ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

describe('filtro por ativo na lista', () => {
  it('sem ativoId, a lista é a de sempre (todos os ativos)', async () => {
    const body = await listar('?tamanho=100');
    assert.equal(body.resumo.total, 28);
    assert.equal(body.resumo.ativos, 2);
  });

  it('ativoId traz só os achados das varreduras daquele ativo, com o resumo do filtro', async () => {
    const body = await listar(`?ativoId=${pequeno}&tamanho=100`);
    assert.equal(body.resumo.total, 3);
    assert.equal(body.resumo.ativos, 1);
    assert.ok(body.dados.every((v: { ativo: string }) => v.ativo === '10.16.0.2'));
    assert.deepEqual(body.resumo.porSeveridade, { Crítico: 1, Alto: 0, Médio: 2, Baixo: 0 });
    assert.equal(body.resumo.porStatus.Resolvida, 1);
  });

  it('achados de várias varreduras do mesmo ativo entram todos', async () => {
    const body = await listar(`?ativoId=${grande}&tamanho=100`);
    assert.equal(body.resumo.total, 25);
    assert.ok(body.dados.every((v: { ativo: string }) => v.ativo === '10.16.0.1'));
  });

  it('ativo existente sem achados: 200 com lista vazia (aqui o vazio é verdade)', async () => {
    const body = await listar(`?ativoId=${vazio}`);
    assert.equal(body.resumo.total, 0);
    assert.deepEqual(body.dados, []);
  });

  it('soma-se (E) à severidade, ao status e à busca', async () => {
    const casos: Array<[string, number]> = [
      [`?ativoId=${grande}&severidade=Crítico`, 10],
      [`?ativoId=${grande}&severidade=m%C3%A9dio`, 15],
      [`?ativoId=${grande}&status=Resolvida`, 5],
      [`?ativoId=${grande}&severidade=M%C3%A9dio&status=Aberta`, 10],
      [`?ativoId=${pequeno}&q=injection`, 1],
      // A busca pelo host de OUTRO ativo não fura o filtro por ativo.
      [`?ativoId=${pequeno}&q=10.16.0.1`, 0],
      [`?ativoId=${grande}&severidade=Baixo`, 0],
      // Vazio conta como ausente, como nos outros filtros.
      ['?ativoId=&tamanho=100', 28],
    ];
    for (const [query, esperado] of casos) assert.equal((await listar(query)).resumo.total, esperado, query);
  });

  it('pagina no banco dentro do filtro: sem repetir nem pular achado, resumo do filtro inteiro', async () => {
    const vistos: string[] = [];
    for (let pagina = 1; pagina <= 3; pagina += 1) {
      const body = await listar(`?ativoId=${grande}&tamanho=10&pagina=${pagina}&ordenar=detectadoEm&direcao=asc`);
      assert.equal(body.resumo.total, 25, 'resumo do filtro, não da página');
      assert.equal(body.resumo.pagina, pagina);
      assert.equal(body.dados.length, pagina < 3 ? 10 : 5);
      vistos.push(...body.dados.map((v: { id: string }) => v.id));
    }
    assert.equal(new Set(vistos).size, 25, 'nenhum achado repetido entre as páginas');
    const todos = await prisma.finding.findMany({ where: { scan: { assetId: grande } }, orderBy: { criadoEm: 'asc' }, select: { id: true } });
    assert.deepEqual(vistos, todos.map((f) => f.id), 'mesma ordem do banco, sem pular');
    const alem = await listar(`?ativoId=${grande}&tamanho=10&pagina=4`);
    assert.deepEqual(alem.dados, []);
    assert.equal(alem.resumo.total, 25);
  });

  it('ordenação por CVSS dentro do filtro', async () => {
    const body = await listar(`?ativoId=${pequeno}&ordenar=cvss&direcao=desc`);
    assert.deepEqual(
      body.dados.map((v: { cvss: number }) => v.cvss),
      [9.8, 6.5, 4.3],
    );
  });
});

describe('ativoId inválido ou inexistente', () => {
  it('fora do formato, repetido ou objeto: 400 ATIVO_ID_INVALIDO', async () => {
    for (const query of [
      '?ativoId=%27%20OR%201%3D1--',
      `?ativoId=${'a'.repeat(65)}`,
      '?ativoId=../ativo',
      `?ativoId=${grande}&ativoId=${pequeno}`,
      '?ativoId[$ne]=x',
      '?ativoId=%20%20',
    ]) {
      const r = await chamar('GET', `/vulnerabilidades${query}`, { token: analista });
      esperaErro(r, 400, 'ATIVO_ID_INVALIDO');
    }
  });

  it('id bem formado de ativo que não existe: 404 ATIVO_NAO_ENCONTRADO, não lista vazia', async () => {
    esperaErro(await chamar('GET', '/vulnerabilidades?ativoId=ativo-inexistente', { token: analista }), 404, 'ATIVO_NAO_ENCONTRADO');
  });

  it('a validação vem antes da paginação (ordem das regras)', async () => {
    const r = await chamar('GET', '/vulnerabilidades?ativoId=%25%25&pagina=0', { token: analista });
    esperaErro(r, 400, 'ATIVO_ID_INVALIDO');
  });

  it('Colaborador continua sem acesso à lista técnica (403), com ou sem ativoId', async () => {
    esperaErro(await chamar('GET', `/vulnerabilidades?ativoId=${grande}`, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
  });
});

describe('o mesmo filtro no PDF do B24', () => {
  /** Quantidade de achados gravada nos metadados (Subject) do PDF. */
  const achadosNoPdf = (pdf: Buffer) => Number(pdf.toString('latin1').match(/\(Achados: (\d+)\)/)?.[1]);

  it('o PDF exporta todos os achados do ativo (sem paginar) e mostra o ativo no cabeçalho', async () => {
    const r = await baixar(`/vulnerabilidades/relatorio.pdf?ativoId=${grande}&status=Aberta`, analista);
    assert.equal(r.status, 200);
    assert.equal(achadosNoPdf(r.corpo), 20);
    assert.equal((await listar(`?ativoId=${grande}&status=Aberta`)).resumo.total, 20, 'a lista concorda');
    const texto = textoDoPdf(r.corpo);
    assert.ok(texto.includes('ativo: Portal Grande (10.16.0.1)'), 'ativo no cabeçalho');
    assert.ok(!texto.includes('10.16.0.2'), 'achado de outro ativo não entra');
  });

  it('a auditoria registra o ativo (com id) e o formato', async () => {
    await baixar(`/vulnerabilidades/relatorio.pdf?ativoId=${pequeno}`, analista);
    const reg = await prisma.auditLog.findFirst({
      where: { acao: 'EXPORTAR_RELATORIO_VULNERABILIDADES' },
      orderBy: { sequencia: 'desc' },
    });
    assert.equal(
      reg?.detalhe,
      `3 achados; severidade: todas; status: todos; busca: nenhuma; ativo: Banco Pequeno (10.16.0.2) [${pequeno}]; formato: PDF`,
    );
  });

  it('ativoId inválido ou inexistente no PDF: o mesmo 400/404, sem arquivo e sem auditoria', async () => {
    const antes = await prisma.auditLog.count({ where: { acao: 'EXPORTAR_RELATORIO_VULNERABILIDADES' } });
    esperaErro(await baixar('/vulnerabilidades/relatorio.pdf?ativoId=x%27y', analista), 400, 'ATIVO_ID_INVALIDO');
    esperaErro(await baixar('/vulnerabilidades/relatorio.pdf?ativoId=ativo-inexistente', analista), 404, 'ATIVO_NAO_ENCONTRADO');
    assert.equal(await prisma.auditLog.count({ where: { acao: 'EXPORTAR_RELATORIO_VULNERABILIDADES' } }), antes);
  });
});
