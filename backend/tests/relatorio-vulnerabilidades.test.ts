// B24 (US-011) — exportar o relatorio de vulnerabilidades em PDF:
// GET /api/vulnerabilidades/relatorio.pdf?severidade=&status=&q= (Administrador/Analista).
// RBAC, cabecalhos do download, conteudo do PDF (acentos, ordem por CVSS), filtros iguais aos
// da lista (validados: 400 com codigo proprio) e a exportacao na trilha de auditoria.
// Banco Postgres isolado (baluarte_test_relatorio_vulnerabilidades) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, baixar, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';
import { textoDoPdf } from './pdf.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');

const ROTA = '/vulnerabilidades/relatorio.pdf';
const ACAO = 'EXPORTAR_RELATORIO_VULNERABILIDADES';

let admin: string;
let analista: string;
let colaborador: string;

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');

  // Cinco achados em dois ativos (varreduras ja concluidas): 2 Críticos, 1 Alto, 2 Médios.
  const web = await prisma.asset.create({ data: { nome: 'Portal de Atendimento', host: '10.24.0.1', tipo: 'Aplicacao' } });
  const banco = await prisma.asset.create({ data: { nome: 'Banco de Faturamento', host: '10.24.0.2', tipo: 'Banco de Dados' } });
  const concluida = { status: 'CONCLUIDA', concluidoEm: new Date() };
  const s1 = await prisma.scan.create({ data: { assetId: web.id, ...concluida } });
  const s2 = await prisma.scan.create({ data: { assetId: banco.id, ...concluida } });
  await prisma.finding.createMany({
    data: [
      { ...dadosAchado('injecao-sql'), scanId: s1.id, status: 'Aberta' },
      { ...dadosAchado('componente-vulneravel'), scanId: s1.id, status: 'Em revisão' },
      { ...dadosAchado('controle-acesso'), scanId: s1.id, status: 'Aberta' },
      { ...dadosAchado('cors-curinga'), scanId: s1.id, status: 'Resolvida' },
      { ...dadosAchado('idor'), scanId: s2.id, status: 'Aberta' },
    ],
  });
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Quantidade de achados gravada nos metadados (Subject) do PDF. */
function achadosNoPdf(pdf: Buffer): number {
  const m = pdf.toString('latin1').match(/\(Achados: (\d+)\)/);
  assert.ok(m, 'Subject com a quantidade de achados');
  return Number(m[1]);
}

async function exportar(query = '', token = analista) {
  const r = await baixar(`${ROTA}${query}`, token);
  assert.equal(r.status, 200, `esperava 200, veio ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

const contarAuditoria = () => prisma.auditLog.count({ where: { acao: ACAO } });

describe('RBAC do relatório', () => {
  it('sem token: 401', async () => {
    const r = await baixar(ROTA);
    esperaErro(r, 401, 'TOKEN_AUSENTE');
  });

  it('Colaborador: 403 (a lista técnica não é dele)', async () => {
    esperaErro(await baixar(ROTA, colaborador), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('Analista e Administrador exportam', async () => {
    await exportar('', analista);
    await exportar('', admin);
  });
});

describe('download do PDF', () => {
  it('responde application/pdf como anexo com nome datado, sem cache', async () => {
    const r = await exportar();
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename="baluarte-vulnerabilidades-\d{4}-\d{2}-\d{2}\.pdf"$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(Number(r.headers.get('content-length')), r.corpo.length);
    assert.equal(r.corpo.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(r.corpo.subarray(-8).toString('latin1'), /%%EOF\s*$/);
  });

  it('a rota do relatório não é confundida com /vulnerabilidades/:id', async () => {
    const r = await baixar(ROTA, analista);
    assert.notEqual(r.body.codigoErro, 'FINDING_NAO_ENCONTRADO');
  });

  it('traz cabeçalho, resumo e achados (com acentos) ordenados por CVSS', async () => {
    const r = await exportar();
    assert.equal(achadosNoPdf(r.corpo), 5);
    const texto = textoDoPdf(r.corpo);
    for (const trecho of [
      'Relatório de vulnerabilidades',
      'por Analista de Segurança (analista@empresa.com) — Analista',
      'severidade: todas; status: todos; busca: nenhuma',
      'Crítico 2',
      'Alto 1',
      'Médio 2',
      'Em revisão 1',
      'Portal de Atendimento',
      'CWE-1321',
      'CVE-2019-10744',
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'Página 1 de 1',
    ])
      assert.ok(texto.includes(trecho), `faltou no PDF: ${trecho}`);
    const ordem = ['9.8', '9.1', '8.1', '6.5', '4.3'].map((n) => texto.indexOf(`\n${n}\n`));
    assert.ok(ordem.every((pos, i) => pos > 0 && (i === 0 || pos > ordem[i - 1])), `ordem por CVSS desc: ${ordem}`);
    // CVSS médio (9.8 + 9.1 + 8.1 + 4.3 + 6.5) / 5 = 7.56 -> 7.6; máximo 9.8.
    assert.ok(texto.includes('\n7.6\n') && texto.includes('\n9.8\n'));
  });
});

describe('filtros (os mesmos da lista)', () => {
  it('severidade, status e busca restringem o relatório como restringem a lista', async () => {
    const casos: Array<[string, number]> = [
      ['?severidade=Crítico', 2],
      ['?severidade=crítico', 2],
      ['?status=Aberta', 3],
      ['?q=10.24.0.2', 1],
      ['?q=injection', 1],
      ['?severidade=M%C3%A9dio&status=Resolvida', 1],
      ['?severidade=Baixo', 0],
      ['?severidade=&status=&q=', 5],
    ];
    for (const [query, esperado] of casos) {
      const r = await exportar(query);
      assert.equal(achadosNoPdf(r.corpo), esperado, `achados no PDF para ${query}`);
      const lista = await chamar('GET', `/vulnerabilidades${query}`, { token: analista });
      assert.equal(lista.body.resumo.total, esperado, `a lista concorda para ${query}`);
    }
  });

  it('o filtro aparece no cabeçalho e só os achados filtrados entram', async () => {
    const texto = textoDoPdf((await exportar('?severidade=cr%C3%ADtico&q=10.24.0.1')).corpo);
    assert.ok(texto.includes('severidade: Crítico; status: todos; busca: "10.24.0.1"'));
    assert.ok(texto.includes('CWE-89') && texto.includes('CWE-1321'));
    assert.ok(!texto.includes('CWE-862') && !texto.includes('CWE-639'), 'fora do filtro não entra');
  });

  it('filtro inválido: 400 com código próprio, sem PDF e sem auditoria', async () => {
    const antes = await contarAuditoria();
    const casos: Array<[string, string]> = [
      ['?severidade=Grav%C3%ADssimo', 'SEVERIDADE_INVALIDA'],
      ['?severidade=Medio', 'SEVERIDADE_INVALIDA'],
      ['?severidade[]=Alto', 'SEVERIDADE_INVALIDA'],
      ['?severidade=Alto&severidade=Baixo', 'SEVERIDADE_INVALIDA'],
      ['?status=Fechada', 'STATUS_INVALIDO'],
      ['?status[$ne]=Aberta', 'STATUS_INVALIDO'],
      [`?q=${'a'.repeat(101)}`, 'BUSCA_INVALIDA'],
      ['?q[$ne]=x', 'BUSCA_INVALIDA'],
    ];
    for (const [query, codigo] of casos) {
      const r = await baixar(`${ROTA}${query}`, analista);
      esperaErro(r, 400, codigo);
      assert.ok(!r.corpo.subarray(0, 5).equals(Buffer.from('%PDF-')));
    }
    assert.equal(await contarAuditoria(), antes);
  });
});

describe('auditoria da exportação', () => {
  it('grava EXPORTAR_RELATORIO_VULNERABILIDADES com autor, quantidade e filtros', async () => {
    await exportar('?severidade=Alto&status=Aberta', analista);
    const reg = await prisma.auditLog.findFirst({ where: { acao: ACAO }, orderBy: { timestamp: 'desc' } });
    assert.ok(reg, 'exportação registrada');
    assert.equal(reg.usuarioId, 'u-001');
    assert.equal(reg.detalhe, '1 achado; severidade: Alto; status: Aberta; busca: nenhuma');
  });

  it('uma exportação = um registro; 403 não registra', async () => {
    const antes = await contarAuditoria();
    await exportar('', admin);
    assert.equal(await contarAuditoria(), antes + 1);
    await baixar(ROTA, colaborador);
    assert.equal(await contarAuditoria(), antes + 1);
    const reg = await prisma.auditLog.findFirst({ where: { acao: ACAO }, orderBy: { timestamp: 'desc' } });
    assert.equal(reg?.usuarioId, 'u-000');
    assert.equal(reg?.detalhe, '5 achados; severidade: todas; status: todos; busca: nenhuma');
  });

  it('a ação aparece na consulta da auditoria (Administrador)', async () => {
    const r = await chamar('GET', `/auditoria?acao=${ACAO}`, { token: admin });
    assert.equal(r.status, 200);
    assert.ok(r.body.resumo.acoes.includes(ACAO));
    assert.ok(r.body.dados.length >= 1);
  });
});
