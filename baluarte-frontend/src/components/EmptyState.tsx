import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button, LinkButton } from '@/components/ui/Button';
import { AlertTriangleIcon, InboxIcon, LockIcon, RefreshIcon } from '@/components/icons';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  to?: string;
  loading?: boolean;
}

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  tone?: 'neutral' | 'error' | 'forbidden';
  /** Compacto (dentro de cards/tabelas). */
  compact?: boolean;
  className?: string;
}

function ActionButton({ action, variant }: { action: EmptyStateAction; variant: 'primary' | 'outline' }) {
  if (action.to) {
    return (
      <LinkButton to={action.to} variant={variant} size="sm">
        {action.label}
      </LinkButton>
    );
  }
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={action.onClick}
      loading={action.loading}
      leftIcon={variant === 'primary' ? <RefreshIcon size={14} /> : undefined}
    >
      {action.label}
    </Button>
  );
}

/** Estado vazio / erro / acesso negado com CTA opcional. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  secondaryAction,
  tone = 'neutral',
  compact,
  className,
}: EmptyStateProps) {
  const defaultIcon =
    tone === 'error' ? (
      <AlertTriangleIcon size={28} />
    ) : tone === 'forbidden' ? (
      <LockIcon size={28} />
    ) : (
      <InboxIcon size={28} />
    );
  const iconTone =
    tone === 'error'
      ? 'bg-red-50 text-severity-critical dark:bg-red-950/50'
      : tone === 'forbidden'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';

  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      data-testid="empty-state"
      data-tone={tone}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div className={cn('mb-4 flex h-14 w-14 items-center justify-center rounded-full', iconTone)}>
        {icon ?? defaultIcon}
      </div>
      <h3 className="text-base font-semibold text-ink dark:text-white">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action && <ActionButton action={action} variant="primary" />}
          {secondaryAction && <ActionButton action={secondaryAction} variant="outline" />}
        </div>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Status HTTP do erro: 403 vira "Acesso negado" (sem retry), 404 vira "Não encontrado". */
  status?: number;
  compact?: boolean;
  className?: string;
}

/** Atalho: EmptyState de erro com botão "Tentar novamente". */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying,
  status,
  compact,
  className,
}: ErrorStateProps) {
  const forbidden = status === 403;
  const notFound = status === 404;
  const resolvedTitle =
    title ??
    (forbidden ? 'Acesso negado' : notFound ? 'Não encontrado' : 'Não foi possível carregar os dados');
  const resolvedMessage =
    message ??
    (forbidden
      ? 'Seu perfil não tem permissão para acessar este conteúdo.'
      : notFound
        ? 'O item solicitado não existe ou foi removido.'
        : 'Verifique sua conexão e tente novamente.');
  const action = forbidden
    ? { label: 'Voltar ao dashboard', to: '/dashboard' }
    : onRetry && !notFound
      ? { label: 'Tentar novamente', onClick: onRetry, loading: retrying }
      : undefined;
  return (
    <EmptyState
      tone={forbidden ? 'forbidden' : 'error'}
      title={resolvedTitle}
      description={resolvedMessage}
      action={action}
      compact={compact}
      className={className}
    />
  );
}
