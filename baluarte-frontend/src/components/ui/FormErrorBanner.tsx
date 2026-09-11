import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SEVERITY_BADGE_CLASS } from '@/lib/severity';
import { AlertCircleIcon } from '@/components/icons';

export interface FormErrorBannerProps {
  /** Mensagem; quando vazia/nula o banner não é renderizado. */
  message?: ReactNode;
  id?: string;
  className?: string;
}

/** Banner único de erro de formulário (role="alert"), com as cores do mapa de severidade. */
export function FormErrorBanner({ message, id, className }: FormErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      id={id}
      role="alert"
      data-testid="form-error"
      className={cn(
        'flex items-start gap-2 rounded-lg px-4 py-3 text-sm ring-1 ring-inset',
        SEVERITY_BADGE_CLASS.critical,
        className,
      )}
    >
      <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}
