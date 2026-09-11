import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useRoutes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_USERS } from '@/mocks/data';
import { routes } from '@/routes';

type Session = NonNullable<AuthProviderProps['initialSession']>;

const ANONYMOUS: Session = { status: 'anonymous', token: null, user: null };

/** Usuários do mock com credenciais conhecidas, um por perfil. */
const USER_ID_BY_ROLE: Record<RBACRole, string> = {
  admin: 'u-000',
  analyst: 'u-001',
  collaborator: 'u-002',
};

/** Cria uma sessão válida e grava token + usuário no storage (o mock lê o token de lá). */
function authenticatedSession(role: RBACRole): Session {
  const found = MOCK_USERS.find((candidate) => candidate.id === USER_ID_BY_ROLE[role]);
  if (!found) throw new Error(`Usuário mock não encontrado para o perfil ${role}`);
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated', token, user };
}

/** Substituto da tela de login que expõe o `state.from` gravado pelo redirecionamento. */
function LoginProbe() {
  const location = useLocation();
  const state = location.state as { from?: { pathname?: string } } | null;
  return (
    <div>
      <p>Página de login</p>
      <p data-testid="from">{state?.from?.pathname ?? ''}</p>
    </div>
  );
}

function renderGuard(path: string, session: Session, roles?: readonly RBACRole[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={session} revalidateOnMount={false}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<ProtectedRoute roles={roles} />}>
            <Route path="/protegida" element={<p>Conteúdo protegido</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function AppRoutes() {
  return useRoutes(routes);
}

function renderApp(path: string, session: Session) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={session} revalidateOnMount={false}>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redireciona usuário anônimo para /login guardando a origem em state.from', () => {
    renderGuard('/protegida', ANONYMOUS);

    expect(screen.getByText('Página de login')).toBeInTheDocument();
    expect(screen.getByTestId('from')).toHaveTextContent('/protegida');
    expect(screen.queryByText('Conteúdo protegido')).not.toBeInTheDocument();
  });

  it('exibe o spinner enquanto a sessão está sendo verificada', () => {
    renderGuard('/protegida', { status: 'loading', token: null, user: null });

    expect(screen.getByRole('status')).toHaveTextContent('Verificando sessão…');
    expect(screen.queryByText('Conteúdo protegido')).not.toBeInTheDocument();
    expect(screen.queryByText('Página de login')).not.toBeInTheDocument();
  });

  it('bloqueia perfil não autorizado com "Acesso negado" sem redirecionar', () => {
    renderGuard('/protegida', authenticatedSession('collaborator'), ['admin', 'analyst']);

    expect(screen.getByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-tone', 'forbidden');
    expect(screen.getByText(/restrita aos perfis Administrador e Analista/)).toBeInTheDocument();
    expect(screen.getByText(/Seu perfil atual é Colaborador/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByText('Conteúdo protegido')).not.toBeInTheDocument();
    expect(screen.queryByText('Página de login')).not.toBeInTheDocument();
  });

  it('renderiza o conteúdo para perfil autorizado', () => {
    renderGuard('/protegida', authenticatedSession('analyst'), ['admin', 'analyst']);

    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
    expect(screen.queryByText('Acesso negado')).not.toBeInTheDocument();
  });

  it('sem `roles`, qualquer usuário autenticado acessa', () => {
    renderGuard('/protegida', authenticatedSession('collaborator'));

    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
  });

  it('aceita `children` no lugar do Outlet', () => {
    render(
      <MemoryRouter initialEntries={['/qualquer']}>
        <AuthProvider initialSession={authenticatedSession('admin')} revalidateOnMount={false}>
          <ProtectedRoute roles={['admin']}>
            <p>Filho protegido</p>
          </ProtectedRoute>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Filho protegido')).toBeInTheDocument();
  });

  describe('integração com a tabela de rotas da aplicação', () => {
    it('anônimo em /vulnerabilities cai na tela de login', async () => {
      renderApp('/vulnerabilities', ANONYMOUS);

      expect(await screen.findByRole('heading', { name: 'Entrar no Baluarte' })).toBeInTheDocument();
    });

    it('colaborador em /users recebe "Acesso negado" dentro do layout autenticado', async () => {
      renderApp('/users', authenticatedSession('collaborator'));

      expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
      expect(screen.getByText(/restrita ao perfil Administrador\./)).toBeInTheDocument();
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('administrador em /users vê a página de usuários', async () => {
      renderApp('/users', authenticatedSession('admin'));

      expect(await screen.findByRole('heading', { name: 'Usuários e perfis de acesso' })).toBeInTheDocument();
      expect(screen.queryByText('Acesso negado')).not.toBeInTheDocument();
    });
  });
});
