import type { ApiError } from '@/types';

// Eventos globais de autenticação/autorização. Vivem num módulo sem dependências
// para que a camada HTTP, a camada mock e os hooks possam emiti-los sem importar
// uns aos outros (evita ciclos de importação).

/** A API respondeu 401: a sessão deve ser encerrada. */
export const UNAUTHORIZED_EVENT = 'baluarte:unauthorized';

/** A API respondeu 403: o perfil em memória pode estar desatualizado. */
export const FORBIDDEN_EVENT = 'baluarte:forbidden';

export type AuthEventName = typeof UNAUTHORIZED_EVENT | typeof FORBIDDEN_EVENT;

/** O usuário registrou a ciência do aviso de monitoramento da estação (B18): o banner some. */
export const MONITORING_ACK_EVENT = 'baluarte:monitoring-ack';

export interface MonitoringAckDetail {
  version: string;
  acknowledgedAt: string;
}

export function dispatchMonitoringAcknowledged(detail: MonitoringAckDetail): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent<MonitoringAckDetail>(MONITORING_ACK_EVENT, { detail }));
}

export function dispatchAuthEvent(name: AuthEventName, detail: ApiError): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent<ApiError>(name, { detail }));
}
