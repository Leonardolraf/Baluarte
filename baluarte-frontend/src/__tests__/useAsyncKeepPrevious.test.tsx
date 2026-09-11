import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsync } from '@/hooks/useAsync';
import { HttpError } from '@/lib/errors';

// Opção `keepPreviousData` do useAsync: mantém o `data` anterior visível enquanto
// as dependências mudam (filtros digitados), em vez de voltar para esqueleto.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Primeira chamada resolve na hora; a segunda fica pendente sob controle do teste. */
function twoStepFetcher() {
  const second = deferred<string>();
  const fn = vi.fn((id: string): Promise<string> =>
    id === 'a' ? Promise.resolve('item-a') : second.promise,
  );
  return { fn, second };
}

describe('useAsync — keepPreviousData', () => {
  it('mantém o data anterior enquanto a nova requisição está em andamento', async () => {
    const { fn, second } = twoStepFetcher();
    const { result, rerender } = renderHook(
      ({ id }) => useAsync(() => fn(id), [id], { keepPreviousData: true }),
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toBe('item-a'));
    expect(result.current.loading).toBe(false);

    rerender({ id: 'b' });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe('item-a');
    expect(result.current.error).toBeNull();

    await act(async () => {
      second.resolve('item-b');
      await second.promise;
    });

    expect(result.current.data).toBe('item-b');
    expect(result.current.loading).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sem a opção, o data volta a null assim que as dependências mudam', async () => {
    const { fn, second } = twoStepFetcher();
    const { result, rerender } = renderHook(({ id }) => useAsync(() => fn(id), [id]), {
      initialProps: { id: 'a' },
    });
    await waitFor(() => expect(result.current.data).toBe('item-a'));

    rerender({ id: 'b' });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await act(async () => {
      second.resolve('item-b');
      await second.promise;
    });

    expect(result.current.data).toBe('item-b');
    expect(result.current.loading).toBe(false);
  });

  it('com a opção, uma falha na nova requisição expõe o erro sem apagar o data anterior', async () => {
    const { fn, second } = twoStepFetcher();
    const { result, rerender } = renderHook(
      ({ id }) => useAsync(() => fn(id), [id], { keepPreviousData: true }),
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toBe('item-a'));

    rerender({ id: 'b' });
    await act(async () => {
      second.reject(new HttpError(503, 'SERVICO_INDISPONIVEL', 'Falha simulada'));
      await second.promise.catch(() => undefined);
    });

    expect(result.current.error).toEqual({
      status: 503,
      code: 'SERVICO_INDISPONIVEL',
      message: 'Falha simulada',
    });
    expect(result.current.data).toBe('item-a');
    expect(result.current.loading).toBe(false);
  });

  it('a primeira execução sempre parte de data null, mesmo com a opção ligada', () => {
    const pending = deferred<string>();
    const { result } = renderHook(() => useAsync(() => pending.promise, [], { keepPreviousData: true }));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it('reload() preserva o data anterior e reload({ reset: true }) o descarta, independentemente da opção', async () => {
    const pending = deferred<string>();
    const fn = vi.fn().mockResolvedValueOnce('inicial').mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => expect(result.current.data).toBe('inicial'));

    act(() => {
      void result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe('inicial');

    act(() => {
      void result.current.reload({ reset: true });
    });
    expect(result.current.data).toBeNull();

    await act(async () => {
      pending.resolve('final');
      await pending.promise;
    });
    expect(result.current.data).toBe('final');
    expect(result.current.loading).toBe(false);
  });
});
