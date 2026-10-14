/**
 * Cliente HTTP da API do produto. Monta a URL a partir da base configurada,
 * injeta o Bearer do token guardado, e desembrulha o envelope padrão
 * `{ status, mensagem?, dados, resumo? }` / `{ status: 'erro', mensagem, codigoErro }`.
 */
import { API_BASE_URL } from '../config';
import { tokenStore } from './tokenStore';

/** Erro de API com o código do backend (ex.: CREDENCIAIS_INVALIDAS). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Erro de rede (sem resposta do servidor): timeout, DNS, offline. */
export class NetworkError extends Error {
  constructor(message = 'Não foi possível conectar à API.') {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Anexa o token de sessão no header Authorization (padrão: true). */
  auth?: boolean;
  /** Tempo máximo da requisição em ms (padrão: 15000). */
  timeoutMs?: number;
}

interface Envelope<T> {
  status?: string;
  mensagem?: string;
  codigoErro?: string;
  code?: string;
  dados?: T;
  resumo?: unknown;
}

function baseUrl(): string {
  if (!API_BASE_URL) {
    // Só acontece se alguém usar o cliente em modo demo (bug de fiação).
    throw new Error('API não configurada (EXPO_PUBLIC_API_BASE_URL ausente).');
  }
  return API_BASE_URL;
}

/**
 * Faz uma requisição e devolve o campo `dados` já tipado. Lança `ApiError` para
 * respostas de erro da API e `NetworkError` quando a requisição nem chega lá.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 15000 } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  const envelope = await parseEnvelope<T>(response);

  if (!response.ok || envelope.status === 'erro') {
    const code = envelope.codigoErro ?? envelope.code ?? 'ERRO_DESCONHECIDO';
    const message = envelope.mensagem ?? 'Erro ao falar com a API.';
    throw new ApiError(message, response.status, code);
  }

  return (envelope.dados ?? (undefined as T)) as T;
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Envelope<T>;
  } catch {
    // Resposta não-JSON (ex.: HTML de erro de proxy): trata como erro genérico.
    return { status: 'erro', mensagem: 'Resposta inesperada da API.', codigoErro: 'RESPOSTA_INVALIDA' };
  }
}
