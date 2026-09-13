import { cn } from '@/lib/cn';

export interface BaluarteMarkProps {
  /** Lado do quadrado, em px. */
  size?: number;
  /** Fundo do quadrado: `ink` (padrão, sobre superfícies claras) ou `inverse` (branco, sobre a placa/barra lateral). */
  tone?: 'ink' | 'inverse';
  className?: string;
}

/**
 * Marca do Baluarte: a planta pentagonal de um bastião. Mesmo desenho do favicon
 * (`public/baluarte.svg`). Decorativa por padrão; passe `aria-label` no elemento pai
 * quando for o único conteúdo de um link.
 */
export function BaluarteMark({ size = 32, tone = 'ink', className }: BaluarteMarkProps) {
  const inverse = tone === 'inverse';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="8" className={inverse ? 'fill-white' : 'fill-ink dark:fill-white'} />
      <path
        d="M16 5.5 26.5 12.6 22.6 25.5H9.4L5.5 12.6Z"
        fill="none"
        strokeWidth="2.2"
        strokeLinejoin="round"
        className={inverse ? 'stroke-ink' : 'stroke-white dark:stroke-ink'}
      />
      <path
        d="M12.2 17.2 15 20l4.9-5.2"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={inverse ? 'stroke-ink' : 'stroke-white dark:stroke-ink'}
      />
    </svg>
  );
}

export interface WordmarkProps {
  /** Cor do texto: herda de `currentColor` por padrão. */
  className?: string;
  /** Linha secundária em caixa alta (ex.: "Plataforma de cibersegurança"). */
  tagline?: string;
}

/** Nome "Baluarte" em Archivo expandido, com linha secundária opcional. */
export function Wordmark({ className, tagline }: WordmarkProps) {
  return (
    <span className={cn('min-w-0 leading-none', className)}>
      <span className="display stretch-xwide block truncate text-[15px]">Baluarte</span>
      {tagline && (
        <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
          {tagline}
        </span>
      )}
    </span>
  );
}
