import ExcelJS from 'exceljs';
import type { Contagem, RelatorioVulnerabilidades } from '../models/vulnerabilidade.model.js';
import { descreverFiltros, horaLocalComoUtc } from './relatorioVulnerabilidade.service.js';

// Desenho do relatorio de vulnerabilidades em Excel (Melhorias #17), a partir do MESMO modelo
// que o PDF usa (`relatorioVulnerabilidade.service.ts#montarRelatorio`): mesmos achados, mesma
// ordem, mesmo resumo. Gerado inteiro em memoria (exceljs, sem binario nativo, nada vai para
// disco), como o PDF.
//
// Duas abas: "Resumo" (cabecalho do relatorio + contagens) e "Achados" (uma linha por achado,
// com cabecalho fixo e filtro do Excel). As colunas sao tipadas: CVSS e numero, data e data,
// para a planilha ordenar e somar sem conversao. Nenhuma celula e formula: texto vindo do banco
// (ex.: nome de programa enviado pelo agente comecando com "=") e gravado como texto e nunca e
// avaliado pelo Excel.

export const ABA_RESUMO = 'Resumo';
export const ABA_ACHADOS = 'Achados';

/** Formato de exibicao das datas (o Excel mostra o valor "de parede" gravado, sem fuso). */
const FORMATO_DATA = 'dd/mm/yyyy hh:mm';
/** CVSS com uma casa, como na tela e no PDF. */
const FORMATO_CVSS = '0.0';

/** Limite de caracteres de uma celula do Excel. */
const MAX_CELULA = 32_767;

/** Colunas da aba de achados: titulo, largura (em caracteres) e formato numerico. */
const COLUNAS: Array<{ titulo: string; largura: number; formato?: string }> = [
  { titulo: '#', largura: 6 },
  { titulo: 'Ativo (host)', largura: 24 },
  { titulo: 'Nome do ativo', largura: 26 },
  { titulo: 'Categoria OWASP', largura: 40 },
  { titulo: 'CWE', largura: 11 },
  { titulo: 'CVE', largura: 17 },
  { titulo: 'Programa', largura: 22 },
  { titulo: 'Versão do programa', largura: 18 },
  { titulo: 'CVSS', largura: 7, formato: FORMATO_CVSS },
  { titulo: 'Vetor CVSS', largura: 46 },
  { titulo: 'Severidade', largura: 11 },
  { titulo: 'Status', largura: 15 },
  { titulo: 'Detectado em (Brasília)', largura: 22, formato: FORMATO_DATA },
];

const COR_CABECALHO = 'FF1E293B';
const COR_TEXTO_CABECALHO = 'FFFFFFFF';

/**
 * Texto seguro para uma celula: o XML da planilha nao aceita caracteres de controle (fora
 * tabulacao e quebras de linha) nem U+FFFE/U+FFFF; um so deles e o Excel recusa abrir o arquivo
 * inteiro. Viram espaco, como no PDF. Texto acima do limite da celula e cortado.
 */
export function textoDeCelula(texto: string): string {
  const limpo = texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ' ');
  return limpo.length > MAX_CELULA ? limpo.slice(0, MAX_CELULA) : limpo;
}

/** Texto opcional: null fica celula vazia (achado do scanner nao tem CVE nem programa). */
function opcional(texto: string | null): string | null {
  return texto === null ? null : textoDeCelula(texto);
}

function negrito(linha: ExcelJS.Row) {
  linha.font = { bold: true };
}

function abaResumo(wb: ExcelJS.Workbook, r: RelatorioVulnerabilidades) {
  const aba = wb.addWorksheet(ABA_RESUMO);
  aba.columns = [{ width: 24 }, { width: 70 }];

  const titulo = aba.addRow(['Baluarte — Relatório de vulnerabilidades']);
  titulo.font = { bold: true, size: 14 };
  const gerado = aba.addRow(['Gerado em (horário de Brasília)', horaLocalComoUtc(r.geradoEm)]);
  gerado.getCell(2).numFmt = FORMATO_DATA;
  gerado.getCell(2).alignment = { horizontal: 'left' };
  aba.addRow(['Gerado por', textoDeCelula(`${r.autor.nome} (${r.autor.email}) — ${r.autor.perfil}`)]);
  aba.addRow(['Filtros', textoDeCelula(descreverFiltros(r.filtros, r.ativo))]);
  aba.addRow([]);

  negrito(aba.addRow(['Resumo']));
  const numero = (rotulo: string, valor: number | null, formato?: string) => {
    // Sem achados nao ha media nem maximo: o traco diz isso, uma celula vazia pareceria dado faltando.
    const linha = aba.addRow([rotulo, valor ?? '—']);
    if (formato && valor !== null) linha.getCell(2).numFmt = formato;
    linha.getCell(2).alignment = { horizontal: 'left' };
  };
  numero('Achados', r.resumo.total);
  numero('Ativos afetados', r.resumo.ativos);
  numero('CVSS médio', r.resumo.cvssMedio, FORMATO_CVSS);
  numero('CVSS máximo', r.resumo.cvssMaximo, FORMATO_CVSS);

  const contagens = (rotulo: string, itens: Contagem[]) => {
    aba.addRow([]);
    negrito(aba.addRow([rotulo, 'Achados']));
    for (const item of itens) numero(item.rotulo, item.total);
  };
  contagens('Por severidade', r.resumo.porSeveridade);
  contagens('Por status', r.resumo.porStatus);
}

function abaAchados(wb: ExcelJS.Workbook, r: RelatorioVulnerabilidades) {
  // Cabecalho fixo ao rolar.
  const aba = wb.addWorksheet(ABA_ACHADOS, { views: [{ state: 'frozen', ySplit: 1 }] });
  aba.columns = COLUNAS.map((c) => ({ header: c.titulo, width: c.largura, style: c.formato ? { numFmt: c.formato } : {} }));
  const cabecalho = aba.getRow(1);
  cabecalho.font = { bold: true, color: { argb: COR_TEXTO_CABECALHO } };
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CABECALHO } };

  r.achados.forEach((a, i) => {
    aba.addRow([
      i + 1,
      textoDeCelula(a.ativo),
      textoDeCelula(a.ativoNome),
      textoDeCelula(a.categoria),
      opcional(a.cwe),
      opcional(a.cve),
      opcional(a.programa),
      opcional(a.programaVersao),
      a.cvss,
      opcional(a.cvssVetor),
      a.severidade,
      a.status,
      horaLocalComoUtc(a.detectadoEm),
    ]);
  });
  // Filtro do Excel no cabecalho (vale para as linhas de baixo).
  aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS.length } };
}

/** Gera a planilha do relatorio (.xlsx) em memoria. */
export async function desenharRelatorioExcel(r: RelatorioVulnerabilidades): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Baluarte';
  wb.lastModifiedBy = 'Baluarte';
  wb.title = 'Relatório de vulnerabilidades — Baluarte';
  wb.subject = `Achados: ${r.resumo.total}`;
  wb.created = r.geradoEm;
  wb.modified = r.geradoEm;
  abaResumo(wb, r);
  abaAchados(wb, r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
