import type { StationEnrollment } from '@/types';

/**
 * Estado do código de vínculo para a tela (#9). O servidor devolve pendente/consumido/expirado e
 * marca a revogação como "consumido" sem ativo; então "consumido" com ativo é "Usado" (a estação
 * se inscreveu) e sem ativo é "Encerrado" (revogado, ou a estação foi removida depois).
 */
export type EnrollmentStateKey = 'pending' | 'used' | 'closed' | 'expired' | 'unknown';

export function enrollmentStateKey(item: Pick<StationEnrollment, 'state' | 'assetId'>): EnrollmentStateKey {
  if (item.state === 'consumed') return item.assetId ? 'used' : 'closed';
  return item.state;
}

export const ENROLLMENT_STATE_LABEL: Record<EnrollmentStateKey, string> = {
  pending: 'Aguardando instalação',
  used: 'Usado',
  closed: 'Encerrado',
  expired: 'Expirado',
  unknown: 'Desconhecido',
};

export const ENROLLMENT_STATE_HINT: Record<EnrollmentStateKey, string> = {
  pending: 'Ainda vale: cole no instalador da estação.',
  used: 'A estação já se inscreveu com este código.',
  closed: 'Revogado (ou a estação foi removida depois de usar).',
  expired: 'Passou das 24 horas sem ser usado.',
  unknown: 'Estado que esta versão da tela não reconhece.',
};

export const ENROLLMENT_STATE_CLASS: Record<EnrollmentStateKey, string> = {
  pending:
    'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-500/30',
  used: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
  closed:
    'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
  expired:
    'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
  unknown:
    'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
};
