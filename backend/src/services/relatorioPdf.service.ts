import PDFDocument from 'pdfkit';
import type { Contagem, RelatorioVulnerabilidades } from '../models/vulnerabilidade.model.js';
import { dataCurta, dataHora, descreverFiltros } from './relatorioVulnerabilidade.service.js';

// Desenho do relatorio de vulnerabilidades em PDF (B24, US-011), a partir do modelo montado
// por `relatorioVulnerabilidade.service.ts`. O PDF e gerado inteiro em memoria (pdfkit, sem
// binario nativo, nada vai para disco), o que funciona tambem na funcao serverless.
//
// As fontes sao as padrao do PDF (Helvetica), que o pdfkit codifica em WinAnsi: cobrem todo o
// portugues (acentos, cedilha, travessao). Texto fora dessa tabela (ex.: um nome de ativo com
// emoji, vindo do agente) passa por `paraWinAnsi`, senao sairia como lixo no arquivo.

const MARGEM = 36;
/** Altura reservada no pe de cada pagina para o rodape ("Página X de Y"). */
const RODAPE = 22;
const PAD = 4;
const CORPO = 8;

const COR = {
  texto: '#0f172a',
  suave: '#475569',
  linha: '#cbd5e1',
  zebra: '#f1f5f9',
  cabecalho: '#1e293b',
  destaque: '#0e7490',
};

const COR_SEVERIDADE: Record<string, string> = {
  Crítico: '#b91c1c',
  Alto: '#c2410c',
  Médio: '#a16207',
  Baixo: '#15803d',
};

/** Colunas da tabela de achados (A4 paisagem: 842 - 2 x 36 = 770 pt de largura util). */
const COLUNAS = [
  { titulo: '#', largura: 24 },
  { titulo: 'Ativo', largura: 120 },
  { titulo: 'Categoria OWASP', largura: 150 },
  { titulo: 'CWE / CVE', largura: 84 },
  { titulo: 'CVSS e vetor', largura: 172 },
  { titulo: 'Severidade', largura: 62 },
  { titulo: 'Status', largura: 78 },
  { titulo: 'Detectado em', largura: 80 },
] as const;

// Caracteres acima de 255 que a codificacao WinAnsi do pdfkit conhece (aspas curvas,
// travessao, reticencias, euro...).
const EXTRAS_WIN_ANSI = new Set([
  402, 710, 732, 338, 339, 352, 353, 376, 381, 382, 8211, 8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230,
  8240, 8249, 8250, 8364, 8482,
]);

/**
 * Deixa o texto representavel nas fontes padrao do PDF: mantem Latin-1 e os extras do
 * WinAnsi; letra com acento fora disso perde o acento (`ő` -> `o`); o resto vira `?`.
 * Caracteres de controle viram espaco (a quebra de linha fica).
 */
export function paraWinAnsi(texto: string): string {
  let saida = '';
  for (const ch of texto.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (c === 10) saida += '\n';
    else if (c < 32 || (c >= 127 && c < 160)) saida += ' ';
    else if (c < 256 || EXTRAS_WIN_ANSI.has(c)) saida += ch;
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      saida += base && [...base].every((b) => b.codePointAt(0)! < 256) ? base : '?';
    }
  }
  return saida;
}

type Doc = InstanceType<typeof PDFDocument>;

/** Gera o PDF do relatorio em memoria. */
export function desenharRelatorioPdf(r: RelatorioVulnerabilidades): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGEM,
      bufferPages: true,
      info: {
        Title: 'Relatório de vulnerabilidades — Baluarte',
        Author: 'Baluarte',
        Subject: `Achados: ${r.resumo.total}`,
        CreationDate: r.geradoEm,
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (parte: Buffer) => partes.push(parte));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    try {
      cabecalho(doc, r);
      resumo(doc, r);
      tabela(doc, r);
      rodapes(doc, r);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/** Escreve texto ja convertido para WinAnsi. */
function escrever(doc: Doc, texto: string, x?: number, y?: number, opcoes?: PDFKit.Mixins.TextOptions) {
  if (x === undefined) return doc.text(paraWinAnsi(texto), opcoes);
  return doc.text(paraWinAnsi(texto), x, y, opcoes);
}

function larguraUtil(doc: Doc): number {
  return doc.page.width - 2 * MARGEM;
}

/** Ultimo y em que um bloco pode terminar sem invadir o rodape. */
function limite(doc: Doc): number {
  return doc.page.height - MARGEM - RODAPE;
}

function cabecalho(doc: Doc, r: RelatorioVulnerabilidades) {
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COR.destaque);
  escrever(doc, 'Baluarte', MARGEM, MARGEM);
  doc.font('Helvetica').fontSize(13).fillColor(COR.texto);
  escrever(doc, 'Relatório de vulnerabilidades');
  doc.moveDown(0.3).fontSize(9).fillColor(COR.suave);
  escrever(doc, `Gerado em ${dataHora(r.geradoEm)} (horário de Brasília) por ${r.autor.nome} (${r.autor.email}) — ${r.autor.perfil}`);
  escrever(doc, `Filtros — ${descreverFiltros(r.filtros)}`);
  doc.moveDown(0.6);
  const y = doc.y;
  doc.moveTo(MARGEM, y).lineTo(MARGEM + larguraUtil(doc), y).lineWidth(0.8).strokeColor(COR.linha).stroke();
  doc.y = y + 10;
}

function titulo(doc: Doc, texto: string) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COR.texto);
  escrever(doc, texto, MARGEM, doc.y);
  doc.moveDown(0.4);
}

function resumo(doc: Doc, r: RelatorioVulnerabilidades) {
  titulo(doc, 'Resumo');
  const cvss = (n: number | null) => (n === null ? '—' : n.toFixed(1));
  const cartoes = [
    ['Achados', String(r.resumo.total)],
    ['Ativos afetados', String(r.resumo.ativos)],
    ['CVSS médio', cvss(r.resumo.cvssMedio)],
    ['CVSS máximo', cvss(r.resumo.cvssMaximo)],
  ];
  const vao = 10;
  const largura = (larguraUtil(doc) - vao * (cartoes.length - 1)) / cartoes.length;
  const y = doc.y;
  cartoes.forEach(([rotulo, valor], i) => {
    const x = MARGEM + i * (largura + vao);
    doc.roundedRect(x, y, largura, 44, 4).lineWidth(0.8).strokeColor(COR.linha).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COR.suave);
    escrever(doc, rotulo, x + 8, y + 7, { width: largura - 16 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.texto);
    escrever(doc, valor, x + 8, y + 19, { width: largura - 16 });
  });
  doc.y = y + 44 + 10;
  contagens(doc, 'Por severidade', r.resumo.porSeveridade, true);
  contagens(doc, 'Por status', r.resumo.porStatus, false);
  doc.moveDown(0.6);
}

/** Linha "Por severidade: Crítico 2 · Alto 1 · ..." com a cor de cada severidade. */
function contagens(doc: Doc, rotulo: string, itens: Contagem[], colorir: boolean) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.texto);
  escrever(doc, `${rotulo}:  `, MARGEM, doc.y, { continued: true });
  itens.forEach((item, i) => {
    const ultimo = i === itens.length - 1;
    doc.font('Helvetica').fillColor(colorir ? (COR_SEVERIDADE[item.rotulo] ?? COR.texto) : COR.texto);
    escrever(doc, `${item.rotulo} ${item.total}`, undefined, undefined, { continued: !ultimo });
    if (!ultimo) {
      doc.fillColor(COR.suave);
      escrever(doc, '   ·   ', undefined, undefined, { continued: true });
    }
  });
  doc.moveDown(0.2);
}

/** Textos das celulas de um achado, na ordem de COLUNAS. */
function celulas(r: RelatorioVulnerabilidades, i: number): string[] {
  const a = r.achados[i];
  return [
    String(i + 1),
    `${a.ativo}\n${a.ativoNome}`,
    // Achado de estacao (B14): a categoria leva o programa instalado (o ativo e a estacao).
    a.programa ? `${a.categoria}\n${[a.programa, a.programaVersao].filter(Boolean).join(' ')}` : a.categoria,
    [a.cwe, a.cve].filter(Boolean).join('\n') || '—',
    `${a.cvss.toFixed(1)}\n${a.cvssVetor ?? 'sem vetor'}`,
    a.severidade,
    a.status,
    dataCurta(a.detectadoEm),
  ];
}

const COLUNA_CVSS = 4;
const COLUNA_SEVERIDADE = 5;
/** O vetor CVSS sai menor que a nota, para caber numa linha. */
const CORPO_VETOR = 7;

/**
 * Desenha (ou so mede, com `desenhar` falso) o texto de uma celula e devolve a altura. Na
 * coluna CVSS, a nota vai em negrito e o vetor em letra menor, embaixo.
 */
function celula(doc: Doc, c: number, texto: string, x: number, y: number, desenhar: boolean): number {
  const width = COLUNAS[c].largura - 2 * PAD;
  const [nota, ...vetor] = texto.split('\n');
  const blocos: Array<[string, string, number]> =
    c === COLUNA_CVSS
      ? [['Helvetica-Bold', nota, CORPO], ['Helvetica', vetor.join('\n'), CORPO_VETOR]]
      : [[c === COLUNA_SEVERIDADE ? 'Helvetica-Bold' : 'Helvetica', texto, CORPO]];
  let altura = 0;
  for (const [fonte, conteudo, tamanho] of blocos) {
    if (!conteudo) continue;
    doc.font(fonte).fontSize(tamanho);
    if (desenhar) escrever(doc, conteudo, x, y + altura, { width });
    altura += doc.heightOfString(paraWinAnsi(conteudo), { width });
  }
  return altura;
}

function alturaDaLinha(doc: Doc, textos: string[]): number {
  return Math.max(...textos.map((t, c) => celula(doc, c, t, 0, 0, false))) + 2 * PAD;
}

function cabecalhoDaTabela(doc: Doc): void {
  const y = doc.y;
  const altura = 18;
  doc.rect(MARGEM, y, larguraUtil(doc), altura).fill(COR.cabecalho);
  doc.font('Helvetica-Bold').fontSize(CORPO).fillColor('#ffffff');
  let x = MARGEM;
  for (const col of COLUNAS) {
    escrever(doc, col.titulo, x + PAD, y + 5, { width: col.largura - 2 * PAD, lineBreak: false });
    x += col.largura;
  }
  doc.y = y + altura;
}

function tabela(doc: Doc, r: RelatorioVulnerabilidades) {
  titulo(doc, 'Achados (do maior para o menor CVSS)');
  if (!r.achados.length) {
    doc.font('Helvetica').fontSize(10).fillColor(COR.suave);
    escrever(doc, 'Nenhum achado para os filtros aplicados.', MARGEM, doc.y);
    return;
  }
  // Cabecalho da tabela + pelo menos uma linha na mesma pagina.
  if (doc.y + 18 + alturaDaLinha(doc, celulas(r, 0)) > limite(doc)) doc.addPage();
  cabecalhoDaTabela(doc);

  r.achados.forEach((achado, i) => {
    const textos = celulas(r, i);
    const altura = alturaDaLinha(doc, textos);
    // Quebra de pagina: a linha nunca e cortada ao meio; o cabecalho se repete.
    if (doc.y + altura > limite(doc)) {
      doc.addPage();
      doc.y = MARGEM;
      cabecalhoDaTabela(doc);
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(MARGEM, y, larguraUtil(doc), altura).fill(COR.zebra);
    let x = MARGEM;
    textos.forEach((texto, c) => {
      doc.fillColor(c === COLUNA_SEVERIDADE ? (COR_SEVERIDADE[achado.severidade] ?? COR.texto) : COR.texto);
      celula(doc, c, texto, x + PAD, y + PAD, true);
      x += COLUNAS[c].largura;
    });
    doc.moveTo(MARGEM, y + altura).lineTo(MARGEM + larguraUtil(doc), y + altura).lineWidth(0.4).strokeColor(COR.linha).stroke();
    doc.y = y + altura;
  });
}

/** "Página X de Y" em todas as paginas (so se sabe o Y no fim: as paginas ficam em buffer). */
function rodapes(doc: Doc, r: RelatorioVulnerabilidades) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    // Escrever na margem de baixo faria o pdfkit abrir pagina nova: zera a margem so aqui.
    const margemOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGEM + 6;
    doc.font('Helvetica').fontSize(8).fillColor(COR.suave);
    escrever(doc, `Baluarte · Relatório de vulnerabilidades · gerado em ${dataHora(r.geradoEm)}`, MARGEM, y, {
      width: larguraUtil(doc),
      lineBreak: false,
    });
    escrever(doc, `Página ${i - start + 1} de ${count}`, MARGEM, y, { width: larguraUtil(doc), align: 'right', lineBreak: false });
    doc.page.margins.bottom = margemOriginal;
  }
}
