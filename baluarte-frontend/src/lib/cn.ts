import { clsx, type ClassValue } from 'clsx';

/** Combina classes Tailwind condicionalmente (wrapper de `clsx`). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
