import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

// Ações são monocromáticas (ver DESIGN.md): a cor da interface é reservada ao risco.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-white shadow-sm hover:bg-ink-soft disabled:bg-ink/60 dark:bg-white dark:text-ink dark:hover:bg-slate-200 dark:disabled:bg-white/60',
  secondary:
    'bg-slate-100 text-ink hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  outline:
    'border border-slate-300 bg-white text-ink hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  ghost:
    'text-slate-600 hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-red-600/60',
};

// Ritmo: sm 32 px / 12 px · md 40 px / 16 px · lg 44 px / 20 px.
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

/** Classes compartilhadas por `Button` e `LinkButton` (fora do componente para preservar o Fast Refresh). */
export const buttonClasses = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
) =>
  cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className,
  );
