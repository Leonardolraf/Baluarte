import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import toast, { Toaster } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, notify, trackOperation, useGlobalLoading, useUiStore } from '@/store/uiStore';

// Estado global de interface (zustand): tema, barra lateral, operações em andamento
// e os toasts de `notify`, que as telas usam fora de componentes.

const initial = useUiStore.getState();

beforeEach(() => {
  useUiStore.setState({ ...initial, theme: 'light', sidebarCollapsed: false, pendingOperations: 0 });
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  act(() => toast.remove());
});

describe('uiStore — tema', () => {
  it('setTheme e toggleTheme aplicam a classe dark no <html> e persistem a escolha', () => {
    act(() => useUiStore.getState().setTheme('dark'));
    expect(useUiStore.getState().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(JSON.parse(window.localStorage.getItem('baluarte.ui') ?? '{}').state).toMatchObject({
      theme: 'dark',
    });

    act(() => useUiStore.getState().toggleTheme());
    expect(useUiStore.getState().theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');

    act(() => useUiStore.getState().toggleTheme());
    expect(useUiStore.getState().theme).toBe('dark');
  });

  it('applyTheme sozinho só mexe no documento', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveClass('dark');
    applyTheme('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(useUiStore.getState().theme).toBe('light');
  });
});

describe('uiStore — barra lateral', () => {
  it('alterna e define o recolhimento; só ele e o tema vão para o storage', () => {
    act(() => useUiStore.getState().toggleSidebar());
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    act(() => useUiStore.getState().toggleSidebar());
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    act(() => useUiStore.getState().setSidebarCollapsed(true));
    act(() => useUiStore.getState().setMobileSidebarOpen(true));

    const persisted = JSON.parse(window.localStorage.getItem('baluarte.ui') ?? '{}').state;
    expect(persisted).toEqual({ theme: 'light', sidebarCollapsed: true });
  });
});

describe('uiStore — operações globais', () => {
  it('trackOperation liga o indicador enquanto a promise está pendente, inclusive em erro', async () => {
    const { result } = renderHook(() => useGlobalLoading());
    expect(result.current).toBe(false);

    let resolve!: (value: string) => void;
    const pending = trackOperation(new Promise<string>((r) => (resolve = r)));
    await waitFor(() => expect(result.current).toBe(true));
    await act(async () => {
      resolve('feito');
      await expect(pending).resolves.toBe('feito');
    });
    expect(result.current).toBe(false);

    await act(async () => {
      await expect(trackOperation(Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    });
    expect(useUiStore.getState().pendingOperations).toBe(0);
  });

  it('finishOperation nunca deixa o contador negativo', () => {
    act(() => useUiStore.getState().finishOperation());
    expect(useUiStore.getState().pendingOperations).toBe(0);
  });
});

describe('notify (toasts)', () => {
  it('mostra sucesso, erro, informação e carregamento, e dispensa pelo id', async () => {
    render(<Toaster />);
    act(() => {
      notify.success('Ativo salvo');
      notify.error('Falha ao salvar');
      notify.info('Varredura em fila');
    });
    expect(await screen.findByText('Ativo salvo')).toBeInTheDocument();
    expect(screen.getByText('Falha ao salvar')).toBeInTheDocument();
    expect(screen.getByText('Varredura em fila')).toBeInTheDocument();
    expect(screen.getByText('ℹ️')).toBeInTheDocument();

    let id = '';
    act(() => {
      id = notify.loading('Processando');
    });
    expect(await screen.findByText('Processando')).toBeInTheDocument();
    act(() => notify.dismiss(id));
    await waitFor(() =>
      expect(screen.getByText('Processando').closest('[role="status"]')?.parentElement).toHaveStyle({
        opacity: '0',
      }),
    );
  });

  it('promise troca a mensagem de carregamento pela de sucesso ou de erro', async () => {
    render(<Toaster />);
    const messages = { loading: 'Enviando…', success: 'Enviado', error: 'Não enviado' };

    let ok!: (value: number) => void;
    let result: Promise<number> = Promise.resolve(0);
    act(() => {
      result = notify.promise(new Promise<number>((r) => (ok = r)), messages);
    });
    expect(await screen.findByText('Enviando…')).toBeInTheDocument();
    await act(async () => {
      ok(42);
      await expect(result).resolves.toBe(42);
    });
    expect(await screen.findByText('Enviado')).toBeInTheDocument();

    await act(async () => {
      await expect(notify.promise(Promise.reject(new Error('x')), messages)).rejects.toThrow('x');
    });
    expect(await screen.findByText('Não enviado')).toBeInTheDocument();
  });
});
