/**
 * Formatação pt-BR sem depender de `Intl` (o resultado é igual em Hermes,
 * no navegador e no Jest). Datas usam o fuso local do aparelho.
 */

/** Marcador de "sem valor" (ex.: taxa de clique sem envios). */
export const EMPTY_VALUE = '—';

type DateInput = Date | string;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function padTwo(value: number | string): string {
  return String(value).padStart(2, '0');
}

/** "18/10 às 09:00h" — linha da lista de campanhas. */
export function formatShortDateTime(value: DateInput): string {
  const date = toDate(value);
  return `${padTwo(date.getDate())}/${padTwo(date.getMonth() + 1)} às ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}h`;
}

/** "18/09/2026 09:00" — banner dos Detalhes. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return `${padTwo(date.getDate())}/${padTwo(date.getMonth() + 1)}/${date.getFullYear()} ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

/** 1234 -> "1.234". */
export function formatNumber(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 24 -> "24%"; `null` -> "—". */
export function formatPercent(value: number | null): string {
  return value === null ? EMPTY_VALUE : `${value}%`;
}

/** Taxa de clique arredondada (clicaram / enviados); `null` quando nada foi enviado. */
export function clickRate(clicked: number, sent: number): number | null {
  if (sent <= 0) return null;
  return Math.round((clicked / sent) * 100);
}

/** "Ana Almeida" -> "AA"; um nome só -> uma letra. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}

/** "Leonardo Rodrigues" -> "Leonardo". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Acentos do português -> letra base (mapa explícito: não depende de `normalize` no Hermes). */
const ACCENTS: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
};

/** Remove acentos e passa para minúsculas ("Patrícia" -> "patricia"). */
export function slugify(value: string): string {
  return value.toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, (char) => ACCENTS[char] ?? char);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "ana.almeida@empresa.com" -> "Ana Almeida". */
export function nameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const words = localPart.split(/[._-]+/).filter(Boolean);
  return words.length > 0 ? words.map(capitalize).join(' ') : email;
}

/** "Patrícia Pereira" -> "patricia.pereira@empresa.com". */
export function emailFromName(name: string, domain = 'empresa.com'): string {
  const localPart = slugify(name).trim().split(/\s+/).join('.');
  return `${localPart}@${domain}`;
}
