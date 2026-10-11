/**
 * Destinatários internos de campanha. Espelha o DOMINIO_INTERNO do backend (que é quem
 * decide): VITE_DOMINIO_INTERNO no build, '@empresa.com' por padrão.
 *
 * DT19: aceita uma lista (vírgula, ponto e vírgula ou espaço) de domínios (`@baluarte.test`
 * ou `baluarte.test`) e de endereços liberados um a um (`pessoa@gmail.com`).
 */
export interface InternalRecipients {
  domains: string[];
  addresses: string[];
}

const DEFAULT_DOMAIN = '@empresa.com';

export function internalRecipients(
  raw: string | undefined = import.meta.env.VITE_DOMINIO_INTERNO,
): InternalRecipients {
  const domains: string[] = [];
  const addresses: string[] = [];
  for (const item of (raw ?? '').toLowerCase().split(/[\s,;]+/)) {
    if (!item) continue;
    const at = item.indexOf('@');
    if (at > 0) addresses.push(item);
    else domains.push(at === 0 ? item : `@${item}`);
  }
  if (domains.length === 0 && addresses.length === 0) domains.push(DEFAULT_DOMAIN);
  return { domains, addresses };
}

/** Primeiro domínio interno (rótulo e compatibilidade); o padrão se a lista só tem endereços. */
export function internalDomain(raw: string | undefined = import.meta.env.VITE_DOMINIO_INTERNO): string {
  return internalRecipients(raw).domains[0] ?? DEFAULT_DOMAIN;
}

export function isInternalRecipient(email: string, rules: InternalRecipients = INTERNAL_RECIPIENTS): boolean {
  const value = email.trim().toLowerCase();
  return rules.addresses.includes(value) || rules.domains.some((d) => value.endsWith(d));
}

/** Texto para a tela: os domínios e quantos endereços estão liberados (sem expor os endereços). */
export function internalRecipientsLabel(rules: InternalRecipients = INTERNAL_RECIPIENTS): string {
  const domains = rules.domains.join(', ');
  const n = rules.addresses.length;
  if (n === 0) return domains;
  const extra = `${n} ${n === 1 ? 'endereço liberado' : 'endereços liberados'}`;
  return domains ? `${domains} e ${extra}` : extra;
}

export const INTERNAL_RECIPIENTS = internalRecipients();
export const INTERNAL_DOMAIN = internalDomain();
