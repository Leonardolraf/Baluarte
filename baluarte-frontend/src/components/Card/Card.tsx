import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { SEVERITY_PLATE_TEXT_CLASS, SEVERITY_TEXT_CLASS } from '@/lib/severity';
import { ChevronRightIcon } from '@/components/icons';

// Ritmo (DESIGN.md): inset de 20 px em cabeçalho, corpo e rodapé; 16 px vertical no
// cabeçalho, 12 px no rodapé. Tabelas "flush" alinham a primeira célula no mesmo inset.

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Ações no canto superior direito (botões, links). */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Remove o padding do corpo (útil para tabelas). */
  flush?: boolean;
  /** Link "ver todos" no cabeçalho. */
  href?: string;
  hrefLabel?: string;
  as?: 'div' | 'section' | 'article';
}

/** Cartão de superfície: título discreto, corpo generoso. */
export function Card({
  title,
  subtitle,
  actions,
  footer,
  flush = false,
  href,
  hrefLabel = 'Ver todos',
  as: Tag = 'section',
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = title || subtitle || actions || href;
  return (
    <Tag className={cn('surface flex flex-col', className)} {...rest}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink dark:text-white">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {href && (
              <Link
                to={href}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-ink underline-offset-4 hover:underline dark:text-white"
              >
                {hrefLabel}
                <ChevronRightIcon size={12} />
              </Link>
            )}
          </div>
        </header>
      )}
      <div className={cn('flex-1', !flush && 'p-5')}>{children}</div>
      {footer && (
        <footer className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">{footer}</footer>
      )}
    </Tag>
  );
}

export interface PlateProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section';
}

/**
 * Placa de comando: a única superfície escura de uma página clara. Reservada ao
 * que precisa ser lido primeiro (índices de risco do dashboard).
 */
export function Plate({ as: Tag = 'section', className, children, ...rest }: PlateProps) {
  return (
    <Tag className={cn('plate p-5 sm:p-6', className)} {...rest}>
      {children}
    </Tag>
  );
}

export type StatTone = 'neutral' | 'critical' | 'high' | 'medium' | 'low' | 'info';

const TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-ink dark:text-white',
  ...SEVERITY_TEXT_CLASS,
};

const PLATE_TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-white',
  ...SEVERITY_PLATE_TEXT_CLASS,
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  href?: string;
  /** `plate`: tile compacto sobre a placa escura. */
  variant?: 'card' | 'plate';
  className?: string;
}

/** Cartão numérico (KPI): numeral em Archivo expandido, rótulo em caixa alta. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  href,
  variant = 'card',
  className,
}: StatCardProps) {
  const onPlate = variant === 'plate';
  const body = (
    <>
      {/* Reserva duas linhas de rótulo: rótulos de 1 e de 2 linhas alinham o numeral na mesma base. */}
      <div className="flex min-h-8 items-start justify-between gap-3">
        {/* Quebra só entre palavras: rótulo partido ao meio ("VULNERABILI/DADES") é ilegível. */}
        <span className={cn('label-caps min-w-0 break-normal', onPlate && '!text-slate-400')}>{label}</span>
        {icon && (
          <span className={cn('shrink-0', onPlate ? 'text-slate-500' : 'text-slate-400 dark:text-slate-500')}>
            {icon}
          </span>
        )}
      </div>
      <div
        className={cn(
          'numeral',
          onPlate ? 'mt-1.5 text-[26px] leading-8' : 'mt-2 text-3xl leading-9',
          onPlate ? PLATE_TONE_CLASS[tone] : TONE_CLASS[tone],
        )}
      >
        {value}
      </div>
      {hint && (
        <div
          className={cn('mt-1 text-xs', onPlate ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400')}
        >
          {hint}
        </div>
      )}
    </>
  );

  const surface = onPlate
    ? 'block rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3'
    : 'surface block p-5';
  const hover = onPlate ? 'transition-colors hover:bg-white/[0.08]' : 'transition-shadow hover:shadow-md';

  if (href) {
    return (
      <Link to={href} className={cn(surface, hover, className)} data-testid="stat-card">
        {body}
      </Link>
    );
  }
  return (
    <div className={cn(surface, className)} data-testid="stat-card">
      {body}
    </div>
  );
}

export interface KeyValueProps {
  items: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }>;
  columns?: 1 | 2;
  className?: string;
}

/** Lista definição (rótulo/valor) usada em resumos de detalhe. */
export function KeyValueList({ items, columns = 1, className }: KeyValueProps) {
  return (
    <dl className={cn('grid gap-x-5 gap-y-4', columns === 2 && 'sm:grid-cols-2', className)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="label-caps">{item.label}</dt>
          <dd
            className={cn(
              'mt-1 break-words text-sm text-ink dark:text-slate-100',
              item.mono && 'font-mono text-xs',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
