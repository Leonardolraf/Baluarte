import { cn } from '@/lib/cn';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Texto para leitores de tela (e visível quando `showLabel`). */
  label?: string;
  showLabel?: boolean;
  /** Cobre o contêiner pai (que deve ser `relative`). */
  overlay?: boolean;
  /** Cobre a viewport inteira. */
  fullscreen?: boolean;
  className?: string;
}

const SIZE: Record<NonNullable<LoadingSpinnerProps['size']>, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-[3px]',
  lg: 'h-12 w-12 border-4',
};

/** Spinner centralizado com `role="status"` e `aria-live`. */
export function LoadingSpinner({
  size = 'md',
  label = 'Carregando…',
  showLabel = false,
  overlay = false,
  fullscreen = false,
  className,
}: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading-spinner"
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        overlay && 'absolute inset-0 z-20 bg-white/70 backdrop-blur-[1px] dark:bg-slate-950/70',
        fullscreen && 'fixed inset-0 z-50 bg-white/80 backdrop-blur-[1px] dark:bg-slate-950/80',
        !overlay && !fullscreen && 'py-16',
        className,
      )}
    >
      <span
        className={cn(
          'animate-spin rounded-full border-slate-200 border-t-brand dark:border-slate-700 dark:border-t-blue-400',
          SIZE[size],
        )}
        aria-hidden="true"
      />
      <span className={cn('text-sm text-slate-500 dark:text-slate-400', !showLabel && 'sr-only')}>
        {label}
      </span>
    </div>
  );
}

/** Esqueleto de bloco (placeholder de carregamento inline). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-slate-200 dark:bg-slate-800', className)}
    />
  );
}
