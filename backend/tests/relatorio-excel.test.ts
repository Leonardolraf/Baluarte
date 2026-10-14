// Melhorias #17 — exportar o relatorio de vulnerabilidades em Excel:
// GET /api/vulnerabilidades/relatorio.xlsx?severidade=&status=&q=&ativoId= (Administrador/Analista).
// Mesmo RBAC, mesmos filtros e mesmos dados do PDF (o mesmo service monta o relatorio), sem
// paginar; cabecalhos do download; o arquivo abre (lido de volta com o exceljs) com colunas
// tipadas; a exportacao entra na auditoria com o formato no detalhe.
// Banco Postgres isolado (baluarte_test_relatorio_excel) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { ADMIN, ANALISTA, baixar, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');

const ROTA = '/vulnerabilidades/relatorio.xlsx';
const ACAO = 'EXPORTAR_RELATORIO_VULNERABILIDADES';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let admin: string;
let analista: string;
let colaborador: string;
let portal = '';
let banco = '';

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');

  // Os mesmos cinco achados do teste do PDF (2 Críticos, 1 Alto, 2 Médios) e mais 120 Médios
  // no portal, para provar que a planilha não pagina (a lista para em 100 por página).
  portal = (await prisma.asset.create({ data: { nome: 'Portal de Atendimento', host: '10.17.0.1', tipo: 'Aplicacao' } })).id;
  banco = (await prisma.asset.create({ data: { nome: 'Banco de Faturamento', host: '10.17.0.2', tipo: 'Banco de Dados' } })).id;
  const concluida = { status: 'CONCLUIDA', concluidoEm: new Date() };
  const s1 = await prisma.scan.create({ data: { assetId: portal, ...concluida } });
  const s2 = await prisma.scan.create({ data: { assetId: banco, ...concluida } });
  await prisma.finding.createMany({
    data: [
      { ...dadosAchado('injecao-sql'), scanId: s1.id, status: 'Aberta', criadoEm: new Date('2026-10-08T00:30:00Z') },
      { ...dadosAchado('componente-vulneravel'), scanId: s1.id, status: 'Em revisão' },
      { ...dadosAchado('controle-acesso'), scanId: s1.id, status: 'Aberta' },
      { ...dadosAchado('cors-curinga'), scanId: s1.id, status: 'Resolvida' },
      { ...dadosAchado('idor'), scanId: s2.id, status: 'Aberta' },
      ...Array.from({ length: 120 }, () => ({ ...dadosAchado('cookie-inseguro'), scanId: s1.id, status: 'Em remediação' })),
    ],
  });
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

async function exportar(query = '', token = analista) {
  const r = await baixar(`${ROTA}${query}`, token);
  assert.equal(r.status, 200, `esperava 200, veio ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

async function abrir(arquivo: Buffer) {
  const wb = new ExcelJS.Workbook();
  // O exceljs tipa a entrada como ArrayBuffer; a copia em Uint8Array entrega um.
  await wb.xlsx.load(new Uint8Array(arquivo).buffer);
  const achados = wb.getWorksheet('Achados');
  const resumo = wb.getWorksheet('Resumo');
  assert.ok(achados && resumo, 'abas Resumo e Achados');
  return { wb, achados, resumo };
}

/** Linhas de dados da aba de achados (sem o cabecalho). */
function linhasDeAchados(aba: ExcelJS.Worksheet): ExcelJS.Row[] {
  const linhas: ExcelJS.Row[] = [];
  aba.eachRow((linha, n) => {
    if (n > 1) linhas.push(linha);
  });
  return linhas;
}

const contarAuditoria = () => prisma.auditLog.count({ where: { acao: ACAO } });

describe('RBAC da planilha (o mesmo do PDF)', () => {
  it('sem token: 401', async () => {
    esperaErro(await baixar(ROTA), 401, 'TOKEN_AUSENTE');
  });

  it('Colaborador: 403', async () => {
    esperaErro(await baixar(ROTA, colaborador), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('Analista e Administrador exportam', async () => {
    await exportar('', analista);
    await exportar('', admin);
  });
});

describe('download da planilha', () => {
  it('responde xlsx como anexo com nome datado, sem cache', async () => {
    const r = await exportar();
    assert.equal(r.headers.get('content-type'), TIPO_XLSX);
    assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename="baluarte-vulnerabilidades-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(Number(r.headers.get('content-length')), r.corpo.length);
    // Um .xlsx é um zip (assinatura PK\x03\x04).
    assert.equal(r.corpo.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004');
  });

  it('a rota da planilha não é confundida com /vulnerabilidades/:id', async () => {
    const r = await baixar(ROTA, analista);
    assert.notEqual(r.body.codigoErro, 'FINDING_NAO_ENCONTRADO');
  });

  it('abre no exceljs: todos os achados (sem paginar), ordem por CVSS, colunas tipadas', async () => {
    const { wb, achados, resumo } = await abrir((await exportar()).corpo);
    assert.equal(wb.subject, 'Achados: 125');
    const linhas = linhasDeAchados(achados);
    assert.equal(linhas.length, 125, 'a planilha leva o filtro inteiro, não uma página');
    const notas = linhas.map((l) => l.getCell(9).value as number);
    assert.deepEqual(notas.slice(0, 4), [9.8, 9.1, 8.1, 6.5]);
    assert.ok(notas.every((n, i) => i === 0 || n <= notas[i - 1]), 'CVSS em ordem decrescente');
    for (const l of linhas) {
      assert.equal(l.getCell(1).type, ExcelJS.ValueType.Number);
      assert.equal(l.getCell(9).type, ExcelJS.ValueType.Number, 'CVSS é número');
      assert.equal(l.getCell(13).type, ExcelJS.ValueType.Date, 'detectado em é data');
    }
    // 00:30 UTC do dia 8 aparece como 21:30 do dia 7 (horário de Brasília).
    const sql = linhas.find((l) => l.getCell(5).value === 'CWE-89')!;
    assert.equal((sql.getCell(13).value as Date).toISOString(), '2026-10-07T21:30:00.000Z');
    assert.equal(sql.getCell(2).value, '10.17.0.1');
    assert.equal(sql.getCell(3).value, 'Portal de Atendimento');
    assert.equal(sql.getCell(10).value, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    assert.equal(sql.getCell(11).value, 'Crítico');
    const valor = (rotulo: string) => {
      let achado: unknown;
      resumo.eachRow((l) => {
        if (l.getCell(1).value === rotulo) achado = l.getCell(2).value;
      });
      return achado;
    };
    assert.equal(valor('Achados'), 125);
    assert.equal(valor('Ativos afetados'), 2);
    assert.equal(valor('Crítico'), 2);
    assert.equal(valor('Em remediação'), 120);
    assert.equal(valor('Filtros'), 'severidade: todas; status: todos; busca: nenhuma');
  });

  it('mesmos dados do PDF: a contagem bate com o PDF e com a lista para o mesmo filtro', async () => {
    const query = '?severidade=Cr%C3%ADtico';
    const { wb } = await abrir((await exportar(query)).corpo);
    const pdf = await baixar(`/vulnerabilidades/relatorio.pdf${query}`, analista);
    const lista = await chamar('GET', `/vulnerabilidades${query}`, { token: analista });
    assert.equal(wb.subject, 'Achados: 2');
    assert.match(pdf.corpo.toString('latin1'), /\(Achados: 2\)/);
    assert.equal(lista.body.resumo.total, 2);
  });
});

describe('filtros (os mesmos da lista e do PDF)', () => {
  it('severidade, status, busca e ativo restringem a planilha como restringem a lista', async () => {
    const casos: Array<[string, number]> = [
      ['?severidade=Crítico', 2],
      ['?severidade=crítico', 2],
      ['?status=Aberta', 3],
      ['?q=10.17.0.2', 1],
      ['?q=injection', 1],
      [`?ativoId=${banco}`, 1],
      [`?ativoId=${portal}`, 124],
      [`?ativoId=${portal}&severidade=Cr%C3%ADtico&status=Aberta`, 1],
      ['?severidade=Baixo', 0],
      ['?severidade=&status=&q=&ativoId=', 125],
    ];
    for (const [query, esperado] of casos) {
      const { achados } = await abrir((await exportar(query)).corpo);
      assert.equal(linhasDeAchados(achados).length, esperado, `linhas na planilha para ${query}`);
      const lista = await chamar('GET', `/vulnerabilidades${query}`, { token: analista });
      assert.equal(lista.body.resumo.total, esperado, `a lista concorda para ${query}`);
    }
  });

  it('o filtro por ativo aparece no resumo e só os achados dele entram', async () => {
    const { achados, resumo } = await abrir((await exportar(`?ativoId=${banco}`)).corpo);
    assert.equal(resumo.getRow(4).getCell(2).value, 'severidade: todas; status: todos; busca: nenhuma; ativo: Banco de Faturamento (10.17.0.2)');
    assert.deepEqual(
      linhasDeAchados(achados).map((l) => l.getCell(2).value),
      ['10.17.0.2'],
    );
  });

  it('filtro inválido ou ativo inexistente: erro com código próprio, sem planilha e sem auditoria', async () => {
    const antes = await contarAuditoria();
    const casos: Array<[string, number, string]> = [
      ['?severidade=Grav%C3%ADssimo', 400, 'SEVERIDADE_INVALIDA'],
      ['?status=Fechada', 400, 'STATUS_INVALIDO'],
      [`?q=${'a'.repeat(101)}`, 400, 'BUSCA_INVALIDA'],
      ['?q[$ne]=x', 400, 'BUSCA_INVALIDA'],
      ['?ativoId=%27%3B--', 400, 'ATIVO_ID_INVALIDO'],
      ['?ativoId=ativo-inexistente', 404, 'ATIVO_NAO_ENCONTRADO'],
    ];
    for (const [query, status, codigo] of casos) {
      const r = await baixar(`${ROTA}${query}`, analista);
      esperaErro(r, status, codigo);
      assert.notEqual(r.headers.get('content-type'), TIPO_XLSX);
    }
    assert.equal(await contarAuditoria(), antes);
  });
});

describe('auditoria da exportação', () => {
  const ultimo = () => prisma.auditLog.findFirst({ where: { acao: ACAO }, orderBy: { sequencia: 'desc' } });

  it('grava EXPORTAR_RELATORIO_VULNERABILIDADES com autor, quantidade, filtros e formato XLSX', async () => {
    await exportar('?severidade=Alto&status=Aberta', analista);
    const reg = await ultimo();
    assert.equal(reg?.usuarioId, 'u-001');
    assert.equal(reg?.detalhe, '1 achado; severidade: Alto; status: Aberta; busca: nenhuma; formato: XLSX');
  });

  it('com ativo: nome, host e id no detalhe', async () => {
    await exportar(`?ativoId=${banco}`, admin);
    const reg = await ultimo();
    assert.equal(reg?.usuarioId, 'u-000');
    assert.equal(
      reg?.detalhe,
      `1 achado; severidade: todas; status: todos; busca: nenhuma; ativo: Banco de Faturamento (10.17.0.2) [${banco}]; formato: XLSX`,
    );
  });

  it('uma exportação = um registro; 403 não registra; o PDF registra o formato PDF', async () => {
    const antes = await contarAuditoria();
    await exportar('', admin);
    assert.equal(await contarAuditoria(), antes + 1);
    await baixar(ROTA, colaborador);
    assert.equal(await contarAuditoria(), antes + 1);
    await baixar('/vulnerabilidades/relatorio.pdf', admin);
    assert.equal(await contarAuditoria(), antes + 2);
    assert.match((await ultimo())?.detalhe ?? '', /; formato: PDF$/);
  });
});
