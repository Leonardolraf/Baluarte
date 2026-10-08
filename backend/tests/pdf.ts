// Leitura minima do PDF gerado pelo pdfkit, para os testes do relatorio (B24) conferirem o
// conteudo sem biblioteca extra: descomprime os streams (FlateDecode) e junta os trechos
// hexadecimais dos operadores TJ, que o pdfkit escreve em WinAnsi. Cada TJ vira uma linha.
// Serve so para PDF do pdfkit com as fontes padrao.
import { inflateSync } from 'node:zlib';

// WinAnsi difere do latin1 so de 0x80 a 0x9F (aspas curvas, travessao, reticencias...).
const WIN_ANSI_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function deWinAnsi(bytes: Buffer): string {
  return [...bytes].map((b) => (b >= 0x80 && b <= 0x9f ? WIN_ANSI_80_9F[b - 0x80] : String.fromCharCode(b))).join('');
}

export function textoDoPdf(pdf: Buffer): string {
  const bruto = pdf.toString('latin1');
  const linhas: string[] = [];
  const inicio = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = inicio.exec(bruto))) {
    const de = m.index + m[0].length;
    const ate = bruto.indexOf('endstream', de);
    let conteudo: string;
    try {
      conteudo = inflateSync(pdf.subarray(de, ate)).toString('latin1');
    } catch {
      continue; // stream que nao e de conteudo (ou nao comprimido)
    }
    for (const tj of conteudo.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('');
      linhas.push(deWinAnsi(Buffer.from(hex, 'hex')));
    }
  }
  return linhas.join('\n');
}

/** Numero de paginas (objetos /Type /Page). */
export function paginasDoPdf(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}
