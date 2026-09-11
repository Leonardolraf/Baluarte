import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsync } from '@/hooks/useAsync';
import { useSort } from '@/hooks/useSort';
import { usePagination } from '@/hooks/usePagination';
import { HttpError } from '@/lib/errors';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsync', () => {
  it('carrega ao montar e expõe data/loading', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAsync(fn, []));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: true });
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('normaliza erros em ApiError e permite reload', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(503, 'SERVICO_INDISPONIVEL', 'Falha simulada'))
      .mockResolvedValueOnce('recuperado');
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual({
      status: 503,
      code: 'SERVICO_INDISPONIVEL',
      message: 'Falha simulada',
    });

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('recuperado');
  });

  it('ignora respostas fora de ordem (a última requisição vence)', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAsync(fn, []));

    let reloadPromise: Promise<void> | undefined;
    act(() => {
      reloadPromise = result.current.reload();
    });
    await act(async () => {
      second.resolve('segunda');
      await reloadPromise;
    });
    expect(result.current.data).toBe('segunda');

    await act(async () => {
      first.resolve('primeira (atrasada)');
      await first.promise;
    });
    expect(result.current.data).toBe('segunda');
  });

  it('não atualiza estado após desmontar e aceita setData funcional', async () => {
    const pending = deferred<number>();
    const fn = vi.fn().mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useAsync(fn, []));
    unmount();
    await act(async () => {
      pending.resolve(42);
      await pending.promise;
    });
    expect(result.current.data).toBeNull();

    const { result: r2 } = renderHook(() => useAsync(async () => 1, []));
    await waitFor(() => expect(r2.current.data).toBe(1));
    act(() => r2.current.setData((prev) => (prev ?? 0) + 10));
    expect(r2.current.data).toBe(11);
  });

  it('reexecuta quando as dependências mudam', async () => {
    const fn = vi.fn(async (id: string) => `item-${id}`);
    const { result, rerender } = renderHook(({ id }) => useAsync(() => fn(id), [id]), {
      initialProps: { id: 'a' },
    });
    await waitFor(() => expect(result.current.data).toBe('item-a'));
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data).toBe('item-b'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('useSort', () => {
  const items = [
    { name: 'Bruno', score: 7.4, at: '2026-09-01T00:00:00.000Z' },
    { name: 'ana', score: 9.8, at: '2026-09-03T00:00:00.000Z' },
    { name: 'Carla', score: null, at: '2026-09-02T00:00:00.000Z' },
  ];
  const accessors = {
    name: (i: (typeof items)[number]) => i.name,
    score: (i: (typeof items)[number]) => i.score,
    at: (i: (typeof items)[number]) => new Date(i.at).getTime(),
  };

  it('ordena por texto (locale pt-BR, sem distinguir caixa), número e data; nulos por último', () => {
    const { result } = renderHook(() => useSort(items, accessors, { key: 'name', direction: 'asc' }));
    expect(result.current.sorted.map((i) => i.name)).toEqual(['ana', 'Bruno', 'Carla']);

    act(() => result.current.toggle('score'));
    expect(result.current.sort).toEqual({ key: 'score', direction: 'asc' });
    expect(result.current.sorted.map((i) => i.name)).toEqual(['Bruno', 'ana', 'Carla']);

    act(() => result.current.toggle('score'));
    expect(result.current.directionOf('score')).toBe('desc');
    expect(result.current.sorted.map((i) => i.name)).toEqual(['ana', 'Bruno', 'Carla']);

    act(() => result.current.toggle('at'));
    expect(result.current.sorted.map((i) => i.name)).toEqual(['Bruno', 'Carla', 'ana']);
  });

  it('alterna asc -> desc -> sem ordenação e mantém a lista original sem mutar', () => {
    const { result } = renderHook(() => useSort(items, accessors));
    expect(result.current.sort).toBeNull();
    expect(result.current.sorted).toBe(items);
    act(() => result.current.toggle('name'));
    act(() => result.current.toggle('name'));
    act(() => result.current.toggle('name'));
    expect(result.current.sort).toBeNull();
    expect(result.current.directionOf('name')).toBeNull();
    expect(items.map((i) => i.name)).toEqual(['Bruno', 'ana', 'Carla']);
  });
});

describe('usePagination', () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it('pagina, limita a navegação e reinicia ao mudar o tamanho da página', () => {
    const { result } = renderHook(() => usePagination(items, 10));
    expect(result.current.total).toBe(23);
    expect(result.current.pageItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.pageItems).toEqual([21, 22, 23]);

    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
    act(() => result.current.setPage(0));
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(25));
    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toHaveLength(23);
  });

  it('volta para uma página válida quando a lista encolhe', () => {
    const { result, rerender } = renderHook(({ list }) => usePagination(list, 10), {
      initialProps: { list: items },
    });
    act(() => result.current.setPage(3));
    rerender({ list: items.slice(0, 5) });
    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toEqual([1, 2, 3, 4, 5]);
  });
});
