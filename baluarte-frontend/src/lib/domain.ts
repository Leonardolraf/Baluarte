/**
 * Domínios internos de campanha, só para o texto da tela. Quem decide o destinatário é o
 * backend (`DOMINIO_INTERNO`), que devolve `DESTINATARIO_EXTERNO` mapeado para o campo.
 *
 * DT20: `VITE_DOMINIO_INTERNO` vai para o JavaScript público (toda variável `VITE_` vai).
 * Por isso aqui só entram DOMÍNIOS; endereço liberado um a um (dado pessoal) fica só no
 * servidor, e uma entrada com endereço nesta variável é ignorada. '@empresa.com' por padrão.
 */
const DEFAULT_DOMAIN = '@empresa.com';

export function internalDomains(raw: string | undefined = import.meta.env.VITE_DOMINIO_INTERNO): string[] {
  const domains: string[] = [];
  for (const item of (raw ?? '').toLowerCase().split(/[\s,;]+/)) {
    if (!item || item.indexOf('@') > 0) continue;
    domains.push(item.startsWith('@') ? item : `@${item}`);
  }
  return domains.length > 0 ? domains : [DEFAULT_DOMAIN];
}

/** Primeiro domínio interno (rótulo e compatibilidade). */
export function internalDomain(raw: string | undefined = import.meta.env.VITE_DOMINIO_INTERNO): string {
  return internalDomains(raw)[0];
}

export const INTERNAL_DOMAINS = internalDomains();
export const INTERNAL_DOMAIN = internalDomain();
