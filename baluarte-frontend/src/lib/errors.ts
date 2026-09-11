import type { ApiError } from '@/types';

/** Erro HTTP normalizado — mesma forma vinda do backend real ou da camada mock. */
export class HttpError extends Error implements ApiError {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}

/** Converte qualquer exceção em `ApiError` legível para a UI. */
export function toApiError(value: unknown): ApiError {
  if (isHttpError(value)) return { status: value.status, code: value.code, message: value.message };
  if (value instanceof Error)
    return { status: 0, code: 'ERRO_DESCONHECIDO', message: value.message || 'Erro inesperado' };
  return { status: 0, code: 'ERRO_DESCONHECIDO', message: 'Erro inesperado' };
}

export function errorMessage(value: unknown, fallback = 'Não foi possível concluir a operação.'): string {
  const err = toApiError(value);
  return err.message || fallback;
}
