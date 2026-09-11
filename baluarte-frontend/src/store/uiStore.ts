import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import toast from 'react-hot-toast';

export type Theme = 'light' | 'dark';

/** Toasts globais (react-hot-toast). Acessível fora de componentes: `notify.error(...)`. */
export const notify = {
  success(message: string): string {
    return toast.success(message);
  },
  error(message: string): string {
    return toast.error(message);
  },
  info(message: string): string {
    return toast(message, { icon: 'ℹ️' });
  },
  loading(message: string): string {
    return toast.loading(message);
  },
  dismiss(id?: string): void {
    toast.dismiss(id);
  },
  promise<T>(promise: Promise<T>, messages: { loading: string; success: string; error: string }): Promise<T> {
    return toast.promise(promise, messages);
  },
};

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  /** Contador de operações globais em andamento (>0 mostra overlay). */
  pendingOperations: number;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  startOperation: () => void;
  finishOperation: () => void;
  notify: typeof notify;
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Aplica a classe `dark` no <html> (Tailwind darkMode: 'class'). */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: systemTheme(),
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      pendingOperations: 0,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () =>
        set((state) => {
          const theme: Theme = state.theme === 'dark' ? 'light' : 'dark';
          applyTheme(theme);
          return { theme };
        }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      startOperation: () => set((state) => ({ pendingOperations: state.pendingOperations + 1 })),
      finishOperation: () =>
        set((state) => ({ pendingOperations: Math.max(0, state.pendingOperations - 1) })),
      notify,
    }),
    {
      name: 'baluarte.ui',
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

/** Seletor conveniente: `const loading = useGlobalLoading()`. */
export function useGlobalLoading(): boolean {
  return useUiStore((state) => state.pendingOperations > 0);
}

/**
 * Envolve uma mutação (criar/editar/excluir) no indicador global de carregamento:
 * o AppLayout mostra o overlay "Processando…" enquanto a promise estiver pendente.
 */
export async function trackOperation<T>(operation: Promise<T>): Promise<T> {
  const { startOperation, finishOperation } = useUiStore.getState();
  startOperation();
  try {
    return await operation;
  } finally {
    finishOperation();
  }
}
