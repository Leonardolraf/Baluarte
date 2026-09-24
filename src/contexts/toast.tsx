import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View } from 'react-native';
import { Toast } from '../components/Toast';
import { styles } from './styles';

/** Tempo que o toast fica visível antes de sumir sozinho. */
export const TOAST_DURATION_MS = 2500;

interface ToastContextValue {
  showToast: (message: string) => void;
  /**
   * A tela em foco informa quantos px o toast desce além da área segura
   * (ex.: a altura do cabeçalho). Devolve a função que desfaz o registro.
   */
  registerToastOffset: (offset: number) => () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastState {
  /** Muda a cada aviso para reiniciar a animação de entrada. */
  id: number;
  message: string;
}

/**
 * O toast mora acima da navegação: continua visível quando a tela troca
 * (ex.: agendar a campanha e cair nos Detalhes). A posição vem da tela em foco:
 * abaixo do cabeçalho quando há um; senão, logo abaixo da área segura.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [offset, setOffset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const offsets = useRef(new Map<number, number>());
  const offsetSequence = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const showToast = useCallback(
    (message: string) => {
      clearTimer();
      sequence.current += 1;
      setToast({ id: sequence.current, message });
      timer.current = setTimeout(() => {
        timer.current = null;
        setToast(null);
      }, TOAST_DURATION_MS);
    },
    [clearTimer],
  );

  const registerToastOffset = useCallback((value: number) => {
    offsetSequence.current += 1;
    const id = offsetSequence.current;
    // Na troca de tela, a que entra registra antes de a que sai desfazer: vale o maior.
    const sync = () => setOffset(Math.max(0, ...offsets.current.values()));
    offsets.current.set(id, value);
    sync();
    return () => {
      offsets.current.delete(id);
      sync();
    };
  }, []);

  // Sem timer pendente depois que o provider sai da tela.
  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo(() => ({ showToast, registerToastOffset }), [showToast, registerToastOffset]);

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.fill}>
        {children}
        {toast ? <Toast key={toast.id} message={toast.message} offset={offset} /> : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return context;
}

/** Enquanto `active`, o toast aparece `offset` px abaixo da área segura (ex.: abaixo do cabeçalho). */
export function useToastOffset(offset: number, active: boolean): void {
  const { registerToastOffset } = useToast();
  useEffect(() => (active ? registerToastOffset(offset) : undefined), [active, offset, registerToastOffset]);
}
