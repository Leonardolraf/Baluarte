import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { ApiError } from '@/types';
import { toApiError } from '@/lib/errors';

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Reexecuta a chamada (mantém `data` anterior enquanto carrega, a menos que `reset` seja true). */
  reload: (options?: { reset?: boolean }) => Promise<void>;
  /** Atualiza `data` localmente (após uma mutação, por exemplo). */
  setData: (updater: T | null | ((previous: T | null) => T | null)) => void;
}

export interface UseAsyncOptions {
  /**
   * Quando `deps` mudam, mantém o `data` anterior visível durante a nova requisição
   * (evita a tela voltar a esqueleto a cada filtro digitado). Padrão: false.
   */
  keepPreviousData?: boolean;
}

/**
 * Executa uma função assíncrona ao montar (e quando `deps` mudam), com
 * proteção contra atualização de estado após desmontar e contra respostas
 * fora de ordem.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: DependencyList = [],
  options: UseAsyncOptions = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keepPreviousData = options.keepPreviousData ?? false;

  const run = useCallback(async (runOptions: { reset?: boolean } = {}) => {
    const id = ++requestId.current;
    if (runOptions.reset) setData(null);
    setError(null);
    setLoading(true);
    try {
      const result = await fnRef.current();
      if (mounted.current && id === requestId.current) {
        setData(result);
        setLoading(false);
      }
    } catch (err) {
      // 401/403 já são emitidos como eventos globais pela camada HTTP (real) ou pelas guardas do mock.
      const apiError = toApiError(err);
      if (mounted.current && id === requestId.current) {
        setError(apiError);
        setLoading(false);
      }
    }
  }, []);

  const firstRun = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const reset = firstRun.current || !keepPreviousData;
    firstRun.current = false;
    void run({ reset });
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: run, setData };
}
