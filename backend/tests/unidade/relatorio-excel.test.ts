// Melhorias #16 e #17 — sem banco: o filtro por ativo no texto do relatorio e da auditoria,
// o nome do arquivo .xlsx, a data "de parede" de Brasilia gravada na planilha e a planilha
// desenhada (lida de volta com o proprio exceljs: abas, cabecalho, tipos das colunas).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { dadosAchado, type ChaveAchado } from '../../src/models/catalogoAchado.model.js';
import type { FindingComScan } from '../../src/models/vulnerabilidade.model.js';
import {
  descreverFiltros,
  horaLocalComoUtc,
  montarRelatorio,
  nomeDoArquivo,
} from '../../src/services/relatorioVulnerabilidade.service.js';
import { ABA_ACHADOS, ABA_RESUMO, desenharRelatorioExcel, textoDeCelula } from '../../src/services/relatorioExcel.service.js';

const AUTOR = { nome: 'Analista de Segurança', email: 'analista@empresa.com', perfil: 'Analista' };
const ATIVO = { id: 'ativo-001', nome: 'Portal do Cliente', host: 'portal.empresa.com' };

let seq = 0;
function achado(chave: ChaveAchado, extra: Partial<FindingComScan> = {}): FindingComScan {
  seq += 1;
  return {
    id: `f${seq}`,
    ...dadosAchado(chave),
    status: 'Aberta',
    criadoEm: new Date('2026-10-01T12:00:00Z'),
    scan: { asset: { host: '10.0.0.1', nome: 'Servidor de Produção' } },
    ...extra,
  };
}

async function abrir(arquivo: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // O exceljs tipa a entrada como ArrayBuffer; a copia em Uint8Array entrega um.
  await wb.xlsx.load(new Uint8Array(arquivo).buffer);
  return wb;
}

/** Linhas da aba como valores (a primeira posicao do exceljs e vazia: colunas comecam em 1). */
function linhas(aba: ExcelJS.Worksheet): unknown[][] {
  const saida: unknown[][] = [];
  aba.eachRow({ includeEmpty: true }, (linha) => saida.push((linha.values as unknown[]).slice(1)));
  return saida;
}

describe('filtro por ativo no texto do relatório (#16)', () => {
  it('sem ativo, o texto de sempre; com ativo, nome e host (e o id só na auditoria)', () => {
    assert.equal(descreverFiltros({}), 'severidade: todas; status: todos; busca: nenhuma');
    assert.equal(
      descreverFiltros({ ativoId: ATIVO.id }, ATIVO),
      'severidade: todas; status: todos; busca: nenhuma; ativo: Portal do Cliente (portal.empresa.com)',
    );
    assert.equal(
      descreverFiltros({ severidade: 'Alto', ativoId: ATIVO.id }, ATIVO, true),
      'severidade: Alto; status: todos; busca: nenhuma; ativo: Portal do Cliente (portal.empresa.com) [ativo-001]',
    );
  });

  it('o modelo do relatório leva o ativo do filtro (ou null)', () => {
    assert.equal(montarRelatorio([], {}, AUTOR).ativo, null);
    assert.deepEqual(montarRelatorio([], { ativoId: ATIVO.id }, AUTOR, new Date(), ATIVO).ativo, ATIVO);
  });
});

describe('datas e nome do arquivo da planilha (#17)', () => {
  it('nome .xlsx com a data de Brasília; o PDF segue .pdf', () => {
    const madrugadaUtc = new Date('2026-10-08T02:00:00Z'); // 23h do dia 7 em Brasília
    assert.equal(nomeDoArquivo(madrugadaUtc, 'xlsx'), 'baluarte-vulnerabilidades-2026-10-07.xlsx');
    assert.equal(nomeDoArquivo(madrugadaUtc), 'baluarte-vulnerabilidades-2026-10-07.pdf');
  });

  it('a hora de Brasília é gravada como está (a planilha não tem fuso)', () => {
    const d = horaLocalComoUtc(new Date('2026-10-08T00:30:15.250Z'));
    assert.equal(d.toISOString(), '2026-10-07T21:30:15.250Z');
  });

  it('texto de célula sem caracteres que o XML da planilha recusa', () => {
    assert.equal(textoDeCelula('a\u0000b\u0007c\u001Fd￾e'), 'a b c d e');
    assert.equal(textoDeCelula('linha 1\nlinha 2\ttab'), 'linha 1\nlinha 2\ttab');
    assert.equal(textoDeCelula('x'.repeat(40_000)).length, 32_767);
  });
});

describe('planilha desenhada (#17)', () => {
  const geradoEm = new Date('2026-10-13T15:45:00Z'); // 12:45 em Brasília
  const findings = [
    achado('cors-curinga', { status: 'Resolvida', criadoEm: new Date('2026-10-08T00:30:00Z') }),
    achado('injecao-sql'),
    achado('componente-vulneravel', {
      programa: '=HYPERLINK("http://exemplo.invalid","clique")',
      programaVersao: '4.17.10\u0001',
      scan: { asset: { host: '10.0.0.2', nome: 'Estação\u0000 do Financeiro' } },
    }),
  ];
  const relatorio = montarRelatorio(findings, { ativoId: ATIVO.id }, AUTOR, geradoEm, ATIVO);

  it('abre no exceljs com as duas abas, propriedades e o cabeçalho do relatório', async () => {
    const wb = await abrir(await desenharRelatorioExcel(relatorio));
    assert.deepEqual(
      wb.worksheets.map((a) => a.name),
      [ABA_RESUMO, ABA_ACHADOS],
    );
    assert.equal(wb.creator, 'Baluarte');
    assert.equal(wb.subject, 'Achados: 3');
    const resumo = linhas(wb.getWorksheet(ABA_RESUMO)!);
    assert.equal(resumo[0][0], 'Baluarte — Relatório de vulnerabilidades');
    assert.equal(resumo[1][0], 'Gerado em (horário de Brasília)');
    assert.ok(resumo[1][1] instanceof Date);
    assert.equal((resumo[1][1] as Date).toISOString(), '2026-10-13T12:45:00.000Z');
    assert.equal(resumo[2][1], 'Analista de Segurança (analista@empresa.com) — Analista');
    assert.equal(resumo[3][1], 'severidade: todas; status: todos; busca: nenhuma; ativo: Portal do Cliente (portal.empresa.com)');
    const valor = (rotulo: string) => resumo.find((l) => l[0] === rotulo)?.[1];
    assert.equal(valor('Achados'), 3);
    assert.equal(valor('Ativos afetados'), 2);
    assert.equal(valor('CVSS máximo'), 9.8);
    assert.equal(valor('Crítico'), 2);
    assert.equal(valor('Médio'), 1);
    assert.equal(valor('Baixo'), 0);
    assert.equal(valor('Resolvida'), 1);
    assert.equal(valor('Risco aceito'), 0);
  });

  it('aba de achados: cabeçalho fixo, ordem por CVSS, CVSS número e data como data', async () => {
    const wb = await abrir(await desenharRelatorioExcel(relatorio));
    const aba = wb.getWorksheet(ABA_ACHADOS)!;
    const [cabecalho, ...dados] = linhas(aba);
    assert.deepEqual(cabecalho, [
      '#',
      'Ativo (host)',
      'Nome do ativo',
      'Categoria OWASP',
      'CWE',
      'CVE',
      'Programa',
      'Versão do programa',
      'CVSS',
      'Vetor CVSS',
      'Severidade',
      'Status',
      'Detectado em (Brasília)',
    ]);
    assert.equal(aba.views[0]?.state, 'frozen');
    assert.equal(dados.length, 3);
    assert.deepEqual(
      dados.map((l) => l[8]),
      [9.8, 9.1, 4.3],
    );
    assert.deepEqual(
      dados.map((l) => l[0]),
      [1, 2, 3],
    );
    for (let i = 2; i <= 4; i += 1) {
      assert.equal(aba.getRow(i).getCell(9).type, ExcelJS.ValueType.Number, 'CVSS é número');
      assert.equal(aba.getRow(i).getCell(9).numFmt, '0.0');
      assert.equal(aba.getRow(i).getCell(13).type, ExcelJS.ValueType.Date, 'detectado em é data');
      assert.equal(aba.getRow(i).getCell(13).numFmt, 'dd/mm/yyyy hh:mm');
    }
    // 00:30 UTC do dia 8 = 21:30 do dia 7 em Brasília.
    const cors = dados.find((l) => l[11] === 'Resolvida')!;
    assert.equal((cors[12] as Date).toISOString(), '2026-10-07T21:30:00.000Z');
    // Achado do scanner: sem CVE nem programa, células vazias (não "null").
    const sql = dados.find((l) => l[4] === 'CWE-89')!;
    assert.equal(sql[5], undefined);
    assert.equal(sql[6], undefined);
  });

  it('texto vindo do banco nunca vira fórmula, e caractere de controle não corrompe o arquivo', async () => {
    const wb = await abrir(await desenharRelatorioExcel(relatorio));
    const aba = wb.getWorksheet(ABA_ACHADOS)!;
    const linha = [2, 3, 4].map((i) => aba.getRow(i)).find((l) => l.getCell(2).value === '10.0.0.2')!;
    assert.equal(linha.getCell(7).type, ExcelJS.ValueType.String);
    assert.equal(linha.getCell(7).value, '=HYPERLINK("http://exemplo.invalid","clique")');
    assert.equal(linha.getCell(8).value, '4.17.10 ');
    assert.equal(linha.getCell(3).value, 'Estação  do Financeiro');
  });

  it('relatório vazio ainda abre: resumo com zero e traço no CVSS, aba de achados só com o cabeçalho', async () => {
    const wb = await abrir(await desenharRelatorioExcel(montarRelatorio([], {}, AUTOR, geradoEm)));
    const resumo = linhas(wb.getWorksheet(ABA_RESUMO)!);
    assert.equal(resumo.find((l) => l[0] === 'Achados')?.[1], 0);
    assert.equal(resumo.find((l) => l[0] === 'CVSS médio')?.[1], '—');
    assert.equal(resumo[3][1], 'severidade: todas; status: todos; busca: nenhuma');
    assert.equal(linhas(wb.getWorksheet(ABA_ACHADOS)!).length, 1);
  });
});
