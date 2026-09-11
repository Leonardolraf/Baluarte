import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { SEVERITY_TEXT_CLASS } from '@/lib/severity';
import { ChevronRightIcon } from '@/components/icons';

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

/** Card de superfície (estilo Kaspersky: título discreto, corpo generoso). */
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
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline dark:text-blue-400"
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

export type StatTone = 'neutral' | 'critical' | 'high' | 'medium' | 'low' | 'info';

const TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-ink dark:text-white',
  ...SEVERITY_TEXT_CLASS,
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  href?: string;
  className?: string;
}

/** Cartão numérico grande (KPI). */
export function StatCard({ label, value, hint, icon, tone = 'neutral', href, className }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="label-caps min-w-0 break-words">{label}</span>
        {icon && <span className="text-slate-400 dark:text-slate-500">{icon}</span>}
      </div>
      <div className={cn('mt-2 text-3xl font-bold tabular-nums tracking-tight', TONE_CLASS[tone])}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </>
  );
  if (href) {
    return (
      <Link
        to={href}
        className={cn('surface block p-5 transition-shadow hover:shadow-md', className)}
        data-testid="stat-card"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={cn('surface p-5', className)} data-testid="stat-card">
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
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', className)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="label-caps">{item.label}</dt>
          <dd
            className={cn(
              'mt-0.5 break-words text-sm text-ink dark:text-slate-100',
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
