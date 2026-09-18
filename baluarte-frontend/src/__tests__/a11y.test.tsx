import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { routes } from '@/routes';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_USERS } from '@/mocks/data';
import type { AuthUser, RBACRole } from '@/types';

// Auditoria automatizada com axe-core em cada página renderizada com dados do mock.
// A regra color-contrast não roda no jsdom (sem layout/pintura); cores foram auditadas manualmente.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function Routed() {
  return useRoutes(routes);
}

function sessionFor(role: RBACRole): AuthUser {
  const user = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const authUser: AuthUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(authUser);
  return authUser;
}

function renderPage(path: string, role: RBACRole | null) {
  const user = role ? sessionFor(role) : null;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider
        initialSession={{ status: user ? 'authenticated' : 'anonymous', token: tokenStorage.get(), user }}
        revalidateOnMount={false}
      >
        <Routed />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function expectNoViolations(container: HTMLElement) {
  const results = await axe(container, AXE_OPTIONS);
  const violations = results.violations.map(
    (v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(violations, violations.join('\n')).toEqual([]);
}

const PAGES: Array<{ path: string; role: RBACRole | null; ready: string | RegExp }> = [
  { path: '/login', role: null, ready: 'Entrar no Baluarte' },
  { path: '/reset-password', role: null, ready: /Redefinir|senha/i },
  { path: '/reset-password?token=demo-reset-1', role: null, ready: 'Criar nova senha' },
  { path: '/about', role: null, ready: /Baluarte/ },
  { path: '/dashboard', role: 'admin', ready: 'Visão geral de risco' },
  { path: '/dashboard', role: 'collaborator', ready: 'Visão geral de risco' },
  { path: '/vulnerabilities', role: 'analyst', ready: 'Vulnerabilidades' },
  { path: '/vulnerabilities/vuln-001', role: 'analyst', ready: /CVE-|A0\d:2021/ },
  { path: '/assets', role: 'analyst', ready: 'Ativos monitorados' },
  { path: '/assets/new', role: 'analyst', ready: /Cadastrar ativo/ },
  { path: '/trainings', role: 'analyst', ready: 'Colaboradores treinados' },
  { path: '/campaigns', role: 'analyst', ready: 'Campanhas de phishing' },
  { path: '/campaigns/camp-001', role: 'analyst', ready: 'Simulação Q3 – Financeiro' },
  { path: '/campaigns/new', role: 'analyst', ready: /Nova campanha/ },
  { path: '/training/trn-urgency', role: 'collaborator', ready: /Reconhecendo|urgência/i },
  { path: '/users', role: 'admin', ready: 'Usuários e perfis de acesso' },
  { path: '/users/new', role: 'admin', ready: /Novo usuário/ },
  { path: '/settings', role: 'admin', ready: 'Configurações' },
];

describe('acessibilidade (axe-core)', () => {
  for (const page of PAGES) {
    it(`${page.path} (${page.role ?? 'público'}) não tem violações`, async () => {
      const { container } = renderPage(page.path, page.role);
      await waitFor(
        () => {
          expect(screen.getAllByText(page.ready).length).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
      // Espera as requisições mock terminarem (spinners somem).
      await waitFor(() => expect(screen.queryAllByTestId('loading-spinner')).toHaveLength(0), {
        timeout: 5000,
      });
      await expectNoViolations(container);
    }, 20_000);
  }
});
