import type { ReactNode } from 'react';

/** Ids auxiliares para ligar `aria-describedby` ao FormField. */
export function describedBy(
  htmlFor: string,
  options: { error?: string; hint?: ReactNode },
): string | undefined {
  if (options.error) return `${htmlFor}-error`;
  if (options.hint) return `${htmlFor}-hint`;
  return undefined;
}
