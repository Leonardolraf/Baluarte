import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { RBACRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { ROLE_LABEL } from '@/lib/roles';

export interface ProtectedRouteProps {
  /** Perfis autorizados. Vazio/omitido = qualquer usuário autenticado. */
  roles?: readonly RBACRole[];
  /** Conteúdo; quando omitido, renderiza `<Outlet />` (uso como rota-layout). */
  children?: ReactNode;
  /** Para onde redirecionar quando não autenticado. */
  redirectTo?: string;
}

/**
 * Guarda de rota:
 *  - sessão carregando -> spinner;
 *  - anônimo -> redireciona para /login guardando a origem em `state.from`;
 *  - perfil não autorizado -> 403 inline (sem redirecionar, para o usuário entender o bloqueio).
 */
export function ProtectedRoute({ roles, children, redirectTo = '/login' }: ProtectedRouteProps) {
  const { status, user, hasRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingSpinner fullscreen label="Verificando sessão…" />;
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  if (roles && roles.length > 0 && !hasRole(...roles)) {
    const allowed = roles.map((r) => ROLE_LABEL[r]);
    const scope = allowed.length === 1 ? `ao perfil ${allowed[0]}` : `aos perfis ${allowed.join(' e ')}`;
    return (
      <EmptyState
        tone="forbidden"
        title="Acesso negado"
        description={`Esta área é restrita ${scope}. Seu perfil atual é ${ROLE_LABEL[user.role]}.`}
        action={{ label: 'Voltar ao dashboard', to: '/dashboard' }}
        className="min-h-[60vh]"
      />
    );
  }

  return <>{children ?? <Outlet />}</>;
}
