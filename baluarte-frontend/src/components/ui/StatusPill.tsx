import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode;
  /** Classes de cor (bg/text/ring) — use os mapas de `@/lib/severity`. */
  colorClass: string;
  /** Ponto colorido à esquerda (classe bg-*). */
  dotClass?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

/** Pílula genérica de status (base do SeverityBadge e dos status de campanha/usuário). */
export function StatusPill({
  label,
  colorClass,
  dotClass,
  icon,
  size = 'sm',
  className,
  ...rest
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        colorClass,
        className,
      )}
      {...rest}
    >
      {dotClass && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)} aria-hidden="true" />}
      {icon}
      {label}
    </span>
  );
}
