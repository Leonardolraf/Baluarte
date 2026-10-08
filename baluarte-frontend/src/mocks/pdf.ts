// -----------------------------------------------------------------------------
// PDF mínimo da camada mock (B24): no modo demonstração não há backend para gerar o
// relatório, então o mock monta um PDF só de texto, uma coluna, fonte Helvetica em
// WinAnsi (acentos do português), com quebra de página e "Página X de Y". Não é o
// relatório do servidor (sem tabela nem cores) — só garante que o botão funciona sem API.
// Fica em `mocks/`, então não entra no build de produção.
// -----------------------------------------------------------------------------

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 10;
const LEADING = 14;
const MAX_CHARS = 95;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN - 20) / LEADING);

/** Caracteres acima de 255 que o WinAnsi tem (posição 0x80–0x9F). */
const WIN_ANSI_EXTRAS: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
};

/** Texto em hexadecimal WinAnsi; o que a fonte não tem vira `?`. */
function winAnsiHex(text: string): string {
  let hex = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 63;
    const byte = WIN_ANSI_EXTRAS[ch] ?? (code >= 32 && code < 256 && (code < 127 || code >= 160) ? code : 63);
    hex += byte.toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}

/** Quebra linhas longas em pedaços de até MAX_CHARS caracteres (nas palavras quando dá). */
function wrap(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > MAX_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_CHARS);
    const at = cut > MAX_CHARS / 2 ? cut : MAX_CHARS;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

/** Monta o PDF (A4 retrato) com as linhas dadas; o rodapé recebe a numeração de páginas. */
export function simplePdf(lines: string[], footer: string): Blob {
  const wrapped = lines.flatMap(wrap);
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
  if (!pages.length) pages.push([]);

  const objects: string[] = [];
  // 1 catálogo, 2 árvore de páginas, 3 fonte; depois pares (página, conteúdo).
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((pageLines, i) => {
    const pageId = pageIds[i];
    const body = pageLines.map((line) => `${winAnsiHex(line)} Tj T*`).join('\n');
    const footerText = `${footer} · Página ${i + 1} de ${pages.length}`;
    const stream =
      `BT /F1 ${FONT_SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_HEIGHT - MARGIN} Td\n${body}\nET\n` +
      `BT /F1 8 Tf ${MARGIN} ${MARGIN / 2} Td ${winAnsiHex(footerText)} Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // Tudo é ASCII (o texto vai em hexadecimal), então posição em caracteres = posição em bytes.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
}
