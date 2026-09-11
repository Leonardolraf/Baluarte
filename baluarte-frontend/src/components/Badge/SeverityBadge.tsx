import type { ReactNode } from 'react';
import type { Severity } from '@/types';
import { SEVERITY_BADGE_CLASS, SEVERITY_DOT_CLASS, SEVERITY_LABEL } from '@/lib/severity';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  XCircleIcon,
} from '@/components/icons';

export interface SeverityBadgeProps {
  severity: Severity;
  /** Texto alternativo (ex.: nome do perfil quando o badge é reaproveitado para RBAC). */
  label?: ReactNode;
  /** Exibe ícone à esquerda. */
  icon?: boolean;
  /** Exibe apenas o ponto colorido (sem ícone). */
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const ICONS: Record<Severity, (props: { size?: number }) => ReactNode> = {
  critical: (p) => <XCircleIcon size={p.size} />,
  high: (p) => <AlertTriangleIcon size={p.size} />,
  medium: (p) => <AlertCircleIcon size={p.size} />,
  low: (p) => <CheckCircleIcon size={p.size} />,
  info: (p) => <InfoIcon size={p.size} />,
};

/** Badge de severidade (Crítico/Alto/Médio/Baixo/Informativo) com cores do CVSS. */
export function SeverityBadge({
  severity,
  label,
  icon = false,
  dot = false,
  size = 'sm',
  className,
}: SeverityBadgeProps) {
  const text = label ?? SEVERITY_LABEL[severity];
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <StatusPill
      data-severity={severity}
      data-testid="severity-badge"
      label={text}
      colorClass={SEVERITY_BADGE_CLASS[severity]}
      dotClass={dot && !icon ? SEVERITY_DOT_CLASS[severity] : undefined}
      icon={icon ? ICONS[severity]({ size: iconSize }) : undefined}
      size={size}
      className={className}
      title={typeof text === 'string' ? undefined : SEVERITY_LABEL[severity]}
    />
  );
}
