import type { Location } from 'react-router-dom';

/** Para onde o login leva quando não há origem válida. */
export const DEFAULT_DESTINATION = '/dashboard';

/**
 * Destino do login a partir da origem guardada pelo `ProtectedRoute` (DT02). Só aceita
 * caminho interno: começa com "/" e o segundo caractere não é "/" nem "\" (que o navegador
 * lê como endereço de outro site, `//evil.com` ou `/\evil.com`), sem barra invertida no
 * caminho nem caractere de controle em parte alguma (na busca, `?q=a\b` é legítimo).
 * Qualquer outra coisa volta para o dashboard. Fecha o redirecionamento aberto do
 * react-router 6 (GHSA-wrjc-x8rr-h8h6) sem trocar de versão maior antes da entrega.
 */
export function internalDestination(from: Partial<Location> | null | undefined): string {
  const pathname = from?.pathname;
  if (typeof pathname !== 'string' || !/^\/(?![/\\])[^\\]*$/.test(pathname)) return DEFAULT_DESTINATION;
  const destination = `${pathname}${from?.search ?? ''}${from?.hash ?? ''}`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(destination)) return DEFAULT_DESTINATION;
  return destination;
}
