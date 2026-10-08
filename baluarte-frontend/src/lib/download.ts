// -----------------------------------------------------------------------------
// Download de arquivos gerados pela API (B24: relatório de vulnerabilidades em PDF).
// O arquivo chega como Blob pelo cliente axios (com o token), então o navegador não
// pode baixá-lo por um link comum: cria-se uma URL temporária e um <a download>.
// -----------------------------------------------------------------------------

/** Nome do arquivo no `Content-Disposition` (`attachment; filename="x.pdf"`), sem caminho. */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return null;
  let name = match[1].trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    // nome sem codificação percentual: fica como veio
  }
  // Nunca um caminho: só o nome (o navegador já faz isso, mas não custa garantir).
  const base = name.split(/[\\/]/).pop() ?? '';
  return base || null;
}

/** Nome padrão do relatório: `baluarte-vulnerabilidades-AAAA-MM-DD.pdf` (data local). */
export function vulnerabilityReportFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `baluarte-vulnerabilidades-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}

/** Entrega o Blob ao navegador como download com o nome dado. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoga depois do clique: alguns navegadores leem a URL de forma assíncrona.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
