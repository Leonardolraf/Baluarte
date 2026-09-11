const LOCALE = 'pt-BR';

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const numberFormatter = new Intl.NumberFormat(LOCALE);

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 10/09/2026 14:32 */
export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value);
  return d ? dateTimeFormatter.format(d) : fallback;
}

/** 10 de set. de 2026 */
export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value);
  return d ? dateFormatter.format(d) : fallback;
}

/** "há 3 h", "há 2 dias", "em 5 dias" — relativo a `now`. */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '—';
  const diffMs = d.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const past = diffMs < 0;

  let unit: string;
  if (minutes < 1) return 'agora';
  if (minutes < 60) unit = `${minutes} min`;
  else if (hours < 24) unit = `${hours} h`;
  else if (days < 30) unit = `${days} ${days === 1 ? 'dia' : 'dias'}`;
  else unit = formatDate(d);

  if (days >= 30) return unit;
  return past ? `há ${unit}` : `em ${unit}`;
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** 23 -> "23%" ; 23.456 -> "23,5%" */
export function formatPercent(value: number, digits = 0): string {
  return `${value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** 9.8 -> "9.8" (CVSS usa ponto decimal por convenção internacional). */
export function formatCvss(value: number): string {
  return value.toFixed(1);
}

/** Converte "2026-09-10T14:32:00.000Z" para o formato aceito por <input type="datetime-local">. */
export function toDateTimeLocalValue(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Limites (em ms) de um dia informado por `<input type="date">` ("aaaa-mm-dd") no fuso LOCAL.
 * `new Date('aaaa-mm-dd')` interpretaria como UTC e deslocaria a data exibida ao usuário.
 */
export function localDayRange(value: string | null | undefined): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const start = new Date(year, month, day, 0, 0, 0, 0);
  if (Number.isNaN(start.getTime()) || start.getMonth() !== month) return null;
  const end = new Date(year, month, day, 23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

/** Só http(s) pode virar link clicável; `javascript:`/`data:` vindos de dados externos são texto. */
export function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value.trim());
}
