import type { SoftwareSource, StationStatus } from '@/types';

// Rótulos e classes da tela de estações monitoradas (B13).

export const STATION_STATUS_LABEL: Record<StationStatus, string> = {
  online: 'Online',
  offline: 'Offline',
};

export const STATION_STATUS_CLASS: Record<StationStatus, string> = {
  online:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
  offline:
    'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
};

export const STATION_STATUS_DOT: Record<StationStatus, string> = {
  online: 'bg-green-500',
  offline: 'bg-slate-400',
};

/** De onde o osquery leu o programa (tabela consultada em cada sistema). */
export const SOFTWARE_SOURCE_LABEL: Record<SoftwareSource, string> = {
  programs: 'Windows',
  deb_packages: 'Pacote .deb',
  rpm_packages: 'Pacote .rpm',
  apps: 'Aplicativo macOS',
  other: 'Outra',
};

/** 900 -> "15 min"; 10800 -> "3 h"; 5400 -> "1 h 30 min". */
export function formatWindow(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Endereço em escuta legível: 0.0.0.0 e :: são todas as interfaces. */
export function listenScope(address: string): 'all' | 'local' | 'specific' {
  const a = address.trim();
  if (a === '0.0.0.0' || a === '::' || a === '*') return 'all';
  if (a.startsWith('127.') || a === '::1' || a === 'localhost') return 'local';
  return 'specific';
}
