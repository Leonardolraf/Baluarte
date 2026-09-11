import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import { Topbar } from '@/components/Layout/Topbar';
import { navGroupsForRole } from '@/components/Sidebar/navigation';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_USERS } from '@/mocks/data';
import { routes } from '@/routes';

// Cobertura da tabela de RBAC do brief: guarda de rotas (admin+analista e admin),
// itens de navegação por perfil e busca global da Topbar.

type Session = NonNullable<AuthProviderProps['initialSession']>;

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

/** Espera as requisições da página terminarem (nenhum spinner visível). */
async function waitForIdle() {
  await waitFor(() => expect(screen.queryAllByTestId('loading-spinner')).toHaveLength(0), {
    timeout: 5000,
  });
}

const FIND_OPTIONS = { timeout: 5000 };

/** Rota bloqueada × perfil sem permissão (grupo admin+analista e grupo admin). */
const BLOCKED: Array<[string, RBACRole]> = [
  ['/vulnerabilities', 'collaborator'],
  ['/vulnerabilities/vuln-001', 'collaborator'],
  ['/assets/new', 'collaborator'],
  ['/campaigns', 'collaborator'],
  ['/campaigns/new', 'collaborator'],
  ['/campaigns/camp-001', 'collaborator'],
  ['/users', 'analyst'],
  ['/users/new', 'analyst'],
  ['/users/u-001/edit', 'analyst'],
];

describe('RBAC — guarda da tabela de rotas', () => {
  it.each(BLOCKED)('%s bloqueia o perfil %s com "Acesso negado"', async (path, role) => {
    renderApp(path, authenticatedSession(role));

    expect(await screen.findByRole('heading', { name: 'Acesso negado' }, FIND_OPTIONS)).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-tone', 'forbidden');
    expect(screen.getByRole('link', { name: 'Voltar ao dashboard' })).toHaveAttribute('href', '/dashboard');
    // Bloqueio acontece dentro do shell autenticado (não redireciona para /login).
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Entrar no Baluarte' })).not.toBeInTheDocument();
  });

  it('analista em /campaigns vê "Campanhas de phishing"', async () => {
    renderApp('/campaigns', authenticatedSession('analyst'));

    expect(
      await screen.findByRole('heading', { name: 'Campanhas de phishing' }, FIND_OPTIONS),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Acesso negado' })).not.toBeInTheDocument();
    await waitForIdle();
  });

  it('administrador em /users vê "Usuários e perfis de acesso"', async () => {
    renderApp('/users', authenticatedSession('admin'));

    expect(
      await screen.findByRole('heading', { name: 'Usuários e perfis de acesso' }, FIND_OPTIONS),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Acesso negado' })).not.toBeInTheDocument();
    await waitForIdle();
  });

  it('colaborador em /dashboard vê "Visão geral de risco"', async () => {
    renderApp('/dashboard', authenticatedSession('collaborator'));

    expect(
      await screen.findByRole('heading', { name: 'Visão geral de risco' }, FIND_OPTIONS),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Acesso negado' })).not.toBeInTheDocument();
    await waitForIdle();
  });
});

describe('RBAC — itens de navegação por perfil', () => {
  const pathsFor = (role: RBACRole | null) =>
    navGroupsForRole(role).flatMap((group) => group.items.map((item) => item.to));

  it('colaborador vê apenas Dashboard e Configurações', () => {
    expect(pathsFor('collaborator')).toEqual(['/dashboard', '/settings']);
  });

  it('analista vê análise e conscientização, mas não Usuários', () => {
    const paths = pathsFor('analyst');
    expect(paths).not.toContain('/users');
    expect(paths).toEqual(
      expect.arrayContaining([
        '/dashboard',
        '/vulnerabilities',
        '/assets/new',
        '/campaigns',
        '/campaigns/new',
        '/settings',
      ]),
    );
  });

  it('administrador vê Usuários', () => {
    const paths = pathsFor('admin');
    expect(paths).toContain('/users');
    expect(paths).toEqual(expect.arrayContaining(pathsFor('analyst')));
  });

  it('sem perfil não há grupos; grupos vazios são omitidos', () => {
    expect(navGroupsForRole(null)).toEqual([]);
    expect(navGroupsForRole(undefined)).toEqual([]);
    expect(navGroupsForRole('collaborator').map((group) => group.title)).toEqual([
      'Análise',
      'Administração',
    ]);
  });
});

describe('RBAC — busca global da Topbar', () => {
  function renderTopbar(role: RBACRole) {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider initialSession={authenticatedSession(role)} revalidateOnMount={false}>
          <Topbar />
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('colaborador não tem a busca de vulnerabilidades', () => {
    renderTopbar('collaborator');

    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('topbar-user')).toHaveTextContent('Colaborador');
  });

  it('analista tem a busca de vulnerabilidades', () => {
    renderTopbar('analyst');

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText(/Buscar vulnerabilidades/)).toHaveAttribute('id', 'global-search');
  });

  it('administrador tem a busca de vulnerabilidades', () => {
    renderTopbar('admin');

    expect(screen.getByRole('search')).toBeInTheDocument();
  });
});
