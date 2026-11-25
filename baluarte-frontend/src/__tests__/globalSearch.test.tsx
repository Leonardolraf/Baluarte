import { isValidElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, type RouteObject } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { Topbar } from '@/components/Layout/Topbar';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import {
  NAV_GROUPS,
  filterPlaces,
  normalizeSearchText,
  searchPlacesForRole,
} from '@/components/Sidebar/navigation';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_USERS } from '@/mocks/data';
import { routes } from '@/routes';

// Card #27: sugestões na busca do topo (combobox + listbox), filtradas pelo perfil a partir
// da mesma definição que protege as rotas.

const ALL_ROLES: RBACRole[] = ['admin', 'analyst', 'collaborator'];
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

function sessionFor(role: RBACRole) {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated' as const, token, user };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderTopbar(role: RBACRole) {
  const utils = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider initialSession={sessionFor(role)} revalidateOnMount={false}>
        <Topbar />
        <button type="button">fora</button>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...utils, user: userEvent.setup() };
}

const combobox = () => screen.getByRole('combobox');
const optionLabels = () =>
  within(screen.getByRole('listbox', { hidden: true }))
    .queryAllByRole('option', { hidden: true })
    .map((option) => option.querySelector('span.min-w-0 > span')?.textContent ?? '');
const location = () => screen.getByTestId('location').textContent;

describe('Busca do topo — abrir e fechar', () => {
  it('ao focar, abre as sugestões com ícone, nome e descrição de cada local', async () => {
    const { user } = renderTopbar('analyst');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');

    await user.click(combobox());

    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: 'Sugestões da busca' });
    expect(combobox()).toHaveAttribute('aria-controls', listbox.id);
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(searchPlacesForRole('analyst').length);
    const dashboard = within(listbox).getByRole('option', { name: /Dashboard/ });
    expect(dashboard).toHaveTextContent('Visão geral do risco técnico e do risco humano');
    expect(dashboard.querySelector('svg')).not.toBeNull();
    for (const option of options) expect(option).toHaveAttribute('aria-selected', 'false');
  });

  it('Ctrl+K (e Cmd+K) leva o foco à busca e abre as sugestões', () => {
    renderTopbar('admin');
    expect(combobox()).not.toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(combobox()).toHaveFocus();
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(combobox(), { key: 'Escape' });
    act(() => combobox().blur());
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(combobox()).toHaveFocus();
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
  });

  it('Esc fecha o painel e o campo continua com o foco', async () => {
    const { user } = renderTopbar('analyst');
    await user.click(combobox());
    await user.keyboard('{Escape}');

    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('listbox', { hidden: true })).not.toBeVisible();
    expect(combobox()).toHaveFocus();
    expect(location()).toBe('/dashboard');
  });

  it('clique fora fecha o painel', async () => {
    const { user } = renderTopbar('analyst');
    await user.click(combobox());
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'fora' }));

    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Busca do topo — filtro', () => {
  it('normaliza acento e maiúscula', () => {
    expect(normalizeSearchText('  Relatório AUDITORIA ')).toBe('relatorio auditoria');
    expect(filterPlaces(searchPlacesForRole('admin'), 'CONFIGURACOES').map((p) => p.to)).toEqual([
      '/settings',
    ]);
    expect(filterPlaces(searchPlacesForRole('admin'), 'auditória').map((p) => p.to)).toEqual(['/audit']);
  });

  it('"rela" deixa só os locais que casam no nome ou na descrição, e a busca por último', async () => {
    const { user } = renderTopbar('analyst');
    await user.type(combobox(), 'RELA');

    const expected = searchPlacesForRole('analyst')
      .filter((p) => normalizeSearchText(`${p.label} ${p.description}`).includes('rela'))
      .map((p) => p.label);
    expect(expected.length).toBeGreaterThan(0);
    expect(optionLabels()).toEqual([...expected, 'Buscar vulnerabilidades por ‘RELA’']);
    expect(optionLabels()).not.toContain('Dashboard');
  });

  it('texto sem local correspondente deixa só a busca de vulnerabilidades', async () => {
    const { user } = renderTopbar('analyst');
    await user.type(combobox(), 'xz-utils');

    expect(optionLabels()).toEqual(['Buscar vulnerabilidades por ‘xz-utils’']);
  });
});

describe('Busca do topo — teclado e escolha', () => {
  it('setas movem a seleção (com volta) e Enter abre o local', async () => {
    const { user } = renderTopbar('analyst');
    await user.click(combobox());
    const options = screen.getAllByRole('option');

    expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(combobox()).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(combobox()).toHaveAttribute('aria-activedescendant', options[1].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(combobox()).toHaveAttribute('aria-activedescendant', options[options.length - 1].id);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(location()).toBe(searchPlacesForRole('analyst')[1].to);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(combobox()).toHaveValue('');
  });

  it('clique numa sugestão abre o local', async () => {
    const { user } = renderTopbar('analyst');
    await user.type(combobox(), 'varred');
    await user.click(screen.getByRole('option', { name: /Varreduras/ }));

    expect(location()).toBe('/scans');
  });

  it('a opção "Buscar vulnerabilidades por" faz a busca de sempre', async () => {
    const { user } = renderTopbar('analyst');
    await user.type(combobox(), 'Log4j 2');
    await user.keyboard('{ArrowUp}{Enter}');

    expect(location()).toBe('/vulnerabilities?q=Log4j%202');
  });

  it('Enter sem opção selecionada mantém o comportamento anterior', async () => {
    const { user } = renderTopbar('analyst');
    await user.type(combobox(), 'Ativos{Enter}');

    // Mesmo casando com o local "Ativos", sem seleção o Enter busca vulnerabilidades.
    expect(location()).toBe('/vulnerabilities?q=Ativos');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('Enter com o campo vazio leva à lista de vulnerabilidades', async () => {
    const { user } = renderTopbar('admin');
    await user.click(combobox());
    await user.keyboard('{Enter}');

    expect(location()).toBe('/vulnerabilities');
  });
});

describe('Busca do topo — acesso por perfil', () => {
  it('Analista não vê Auditoria nem Usuários; Administrador vê', async () => {
    const analyst = renderTopbar('analyst');
    await analyst.user.click(combobox());
    expect(optionLabels()).not.toContain('Auditoria');
    expect(optionLabels()).not.toContain('Usuários');
    expect(optionLabels()).toEqual(expect.arrayContaining(['Vulnerabilidades', 'Campanhas', 'Estações']));
    analyst.unmount();

    const admin = renderTopbar('admin');
    await admin.user.click(combobox());
    expect(optionLabels()).toEqual(expect.arrayContaining(['Auditoria', 'Usuários', 'Monitoramento']));
  });

  it('as sugestões de cada perfil são exatamente os itens do menu dele', () => {
    for (const role of ALL_ROLES) {
      const fromMenu = NAV_GROUPS.flatMap((g) => g.items).filter((item) => item.roles.includes(role));
      expect(searchPlacesForRole(role)).toEqual(fromMenu);
    }
    expect(searchPlacesForRole(null)).toEqual([]);
  });

  it('Colaborador continua sem barra, e Ctrl+K não faz nada', () => {
    renderTopbar('collaborator');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

/** Perfis exigidos pelas guardas `ProtectedRoute` no caminho até a rota de `path` (null = só login). */
function guardRolesFor(path: string): readonly RBACRole[] | null | undefined {
  function walk(
    nodes: RouteObject[],
    inherited: readonly RBACRole[] | null,
  ): readonly RBACRole[] | null | undefined {
    for (const node of nodes) {
      const element = node.element as ReactNode;
      let roles = inherited;
      if (isValidElement(element) && element.type === ProtectedRoute) {
        const own = (element.props as { roles?: readonly RBACRole[] }).roles;
        if (own && own.length > 0) roles = own;
      }
      if (node.path === path) return roles;
      if (node.children) {
        const found = walk(node.children, roles);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  return walk(routes, null);
}

describe('Busca do topo — coerência entre menu e guarda das rotas', () => {
  const items = NAV_GROUPS.flatMap((g) => g.items);

  it.each(items.map((item) => [item.to, item] as const))(
    '%s: os perfis do menu/busca são os mesmos da guarda da rota',
    (_path, item) => {
      const guard = guardRolesFor(item.to);
      expect(guard, `rota ${item.to} não existe em routes.tsx`).not.toBeUndefined();
      expect([...(guard ?? ALL_ROLES)].sort()).toEqual([...item.roles].sort());
    },
  );
});

describe('Busca do topo — acessibilidade', () => {
  it('passa no axe com o painel fechado, aberto e com opção ativa', async () => {
    const { container, user } = renderTopbar('admin');
    expect((await axe(container, AXE_OPTIONS)).violations).toEqual([]);

    await user.type(combobox(), 'a');
    await user.keyboard('{ArrowDown}');
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    const results = await axe(container, AXE_OPTIONS);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
