/**
 * Mesma normalização do backend (`normalizarHost`, B10): um endereço colado com
 * `http://` ou `https://` vira só o host (sem caminho, query, fragmento, porta e barra
 * final). Sem esquema, o valor só perde os espaços das pontas.
 */
export function normalizeAssetHost(value: string): string {
  const trimmed = value.trim();
  const scheme = /^https?:\/\//i.exec(trimmed);
  if (!scheme) return trimmed;
  return (trimmed.slice(scheme[0].length).split(/[/?#]/, 1)[0] ?? '').replace(/:\d{1,5}$/, '');
}
