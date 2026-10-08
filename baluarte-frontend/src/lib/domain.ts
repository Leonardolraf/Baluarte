/**
 * Domínio interno aceito como destinatário de campanha. Espelha o DOMINIO_INTERNO do
 * backend (que é quem decide): VITE_DOMINIO_INTERNO no build, '@empresa.com' por padrão.
 */
export function internalDomain(raw: string | undefined = import.meta.env.VITE_DOMINIO_INTERNO): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return '@empresa.com';
  return value.startsWith('@') ? value : `@${value}`;
}

export const INTERNAL_DOMAIN = internalDomain();
