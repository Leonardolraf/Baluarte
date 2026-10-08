import type { ScanReport } from '@/types';

// Ciclo e progresso da varredura simulada na camada mock: espelha
// backend/src/services/cicloVarredura.service.ts (B21 + B26). Tudo sai do tempo decorrido
// desde o início, avaliado na leitura: em fila nos primeiros 5 s (0%), em andamento até
// 20 s (1% a 99%, passando pelas etapas abaixo, distribuídas por igual), concluída depois (100%).

export const SCAN_QUEUE_MS = 5_000;
export const SCAN_DURATION_MS = 20_000;

export const SCAN_STAGE_QUEUED = 'Na fila';
export const SCAN_STAGE_COMPLETED = 'Concluída';
export const SCAN_STAGES_RUNNING = [
  'Mapeando superfície',
  'Testando injeção',
  'Testando autenticação',
  'Gerando relatório',
] as const;

export interface ScanProgress {
  status: ScanReport['status'];
  progress: number;
  stage: string;
  estimatedCompletionAt: string;
}

/** Status, percentual, etapa e conclusão prevista pelo tempo decorrido desde `startedAt`. */
export function scanProgressByTime(startedAt: string, now: number): ScanProgress {
  const start = new Date(startedAt).getTime();
  const elapsed = now - start;
  const estimatedCompletionAt = new Date(start + SCAN_DURATION_MS).toISOString();
  if (elapsed >= SCAN_DURATION_MS)
    return { status: 'completed', progress: 100, stage: SCAN_STAGE_COMPLETED, estimatedCompletionAt };
  if (elapsed < SCAN_QUEUE_MS)
    return { status: 'queued', progress: 0, stage: SCAN_STAGE_QUEUED, estimatedCompletionAt };
  const fraction = (elapsed - SCAN_QUEUE_MS) / (SCAN_DURATION_MS - SCAN_QUEUE_MS);
  const progress = Math.min(99, Math.max(1, Math.floor(fraction * 100)));
  const index = Math.min(SCAN_STAGES_RUNNING.length - 1, Math.floor(fraction * SCAN_STAGES_RUNNING.length));
  return { status: 'running', progress, stage: SCAN_STAGES_RUNNING[index]!, estimatedCompletionAt };
}
