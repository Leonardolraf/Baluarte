import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TrainingId } from '../types';
import { useAuth } from './auth';

/** Conclusões registradas, pela chave `${usuário}:${módulo}`. */
type CompletionMap = Record<string, boolean>;

interface TrainingsContextValue {
  /** O módulo foi concluído por quem está logado? */
  isCompleted: (id: TrainingId) => boolean;
  /** Alterna a conclusão do módulo para quem está logado e devolve o novo estado. */
  toggleCompleted: (id: TrainingId) => boolean;
}

const TrainingsContext = createContext<TrainingsContextValue | null>(null);

function completionKey(userId: string, trainingId: TrainingId): string {
  return `${userId}:${trainingId}`;
}

/**
 * Guarda a conclusão por pessoa e por módulo: sair e voltar ao treinamento mantém
 * o estado, e quem entra com outra conta não herda o que a anterior concluiu.
 */
export function TrainingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [completed, setCompleted] = useState<CompletionMap>({});

  const isCompleted = useCallback(
    (id: TrainingId) => userId !== null && completed[completionKey(userId, id)] === true,
    [completed, userId],
  );

  const toggleCompleted = useCallback(
    (id: TrainingId) => {
      if (userId === null) return false;
      const key = completionKey(userId, id);
      const next = completed[key] !== true;
      setCompleted((current) => ({ ...current, [key]: next }));
      return next;
    },
    [completed, userId],
  );

  const value = useMemo(() => ({ isCompleted, toggleCompleted }), [isCompleted, toggleCompleted]);

  return <TrainingsContext.Provider value={value}>{children}</TrainingsContext.Provider>;
}

export function useTrainings(): TrainingsContextValue {
  const context = useContext(TrainingsContext);
  if (!context) throw new Error('useTrainings precisa estar dentro de <TrainingsProvider>.');
  return context;
}
