import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole, Vulnerability, VulnerabilityFilters } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import { HttpError } from '@/lib/errors';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { mockApi, mockRiskScore } from '@/mocks/api';
import { MOCK_CREDENTIALS, MOCK_USERS, MOCK_VULNERABILITIES } from '@/mocks/data';
import { VulnTable } from '@/components/Table/VulnTable';
import DashboardPage from '@/pages/Dashboard/DashboardPage';
import VulnDetailPage from '@/pages/Vulnerabilities/VulnDetailPage';
import VulnListPage from '@/pages/Vulnerabilities/VulnListPage';

// B25 (parte sem migration): lista paginada e ordenada no servidor, card dos 5 ativos de maior
// risco no dashboard e o histórico honesto do detalhe da vulnerabilidade.

type Session = NonNullable<AuthProviderProps['initialSession']>;

const USER_ID_BY_ROLE: Record<RBACRole, string> = { admin: 'u-000', analyst: 'u-001', collaborator: 'u-002' };

function session(role: RBACRole): Session {
  const found = MOCK_USERS.find((u) => u.id === USER_ID_BY_ROLE[role])!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated', token, user };
}

function renderAt(path: string, role: RBACRole, routes: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={session(role)} revalidateOnMount={false}>
        {routes}
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function loginAs(role: RBACRole) {
  const user = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const cred = MOCK_CREDENTIALS.find((c) => c.userId === user.id)!;
  const response = await mockApi.login({ email: cred.email, password: cred.password });
  tokenStorage.set(response.token);
  userStorage.set(response.user);
}

const rowIds = () => screen.getAllByTestId('vuln-row').map((row) => row.getAttribute('data-id') ?? '');

describe('lista de vulnerabilidades paginada (mock espelha o servidor)', () => {
  it('percorrer as páginas não repete nem pula achado, com o resumo do filtro inteiro', async () => {
    await loginAs('analyst');
    const ids: string[] = [];
    let total = Infinity;
    for (let page = 1; (page - 1) * 4 < total; page++) {
      const r = await mockApi.listVulnerabilities(
        {},
        { page, pageSize: 4, sort: { key: 'cvss', direction: 'desc' } },
      );
      total = r.summary.total;
      expect(r).toMatchObject({ page, pageSize: 4 });
      ids.push(...r.items.map((v) => v.id));
    }
    expect(total).toBe(MOCK_VULNERABILITIES.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(MOCK_VULNERABILITIES.map((v) => v.id).sort());
  });

  it('sem opções devolve a página 1 de 20, a mais recente primeiro; página inválida é 400', async () => {
    await loginAs('analyst');
    const first = await mockApi.listVulnerabilities();
    expect(first).toMatchObject({ page: 1, pageSize: 20 });
    const times = first.items.map((v) => new Date(v.detectedAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    await expect(mockApi.listVulnerabilities({}, { pageSize: 101 })).rejects.toMatchObject({
      status: 400,
      code: 'TAMANHO_INVALIDO',
    });
    await expect(mockApi.listVulnerabilities({}, { page: 0 })).rejects.toBeInstanceOf(HttpError);
  });

  it('o relatório em PDF leva todos os achados do filtro, não só uma página', async () => {
    await loginAs('admin');
    const filters: VulnerabilityFilters = { status: 'open' };
    const { summary } = await mockApi.listVulnerabilities(filters, { pageSize: 1 });
    expect(summary.total).toBeGreaterThan(1);
    await mockApi.exportVulnerabilityReport(filters);
    const audit = await mockApi.listAuditLog({ action: 'EXPORTAR_RELATORIO_VULNERABILIDADES' });
    expect(audit.items[0]?.detail).toMatch(new RegExp(`^${summary.total} achados;`));
  });
});

describe('VulnTable no modo servidor', () => {
  const items = MOCK_VULNERABILITIES.slice(0, 3);
  const noFilters: VulnerabilityFilters = { severity: 'all', status: 'all', query: '' };

  function renderTable(overrides: Partial<React.ComponentProps<typeof VulnTable>['server']> = {}) {
    const server = {
      page: 2,
      pageSize: 20,
      total: 45,
      sort: null,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onSortChange: vi.fn(),
      pageSizeOptions: [10, 20, 50, 100],
      ...overrides,
    };
    render(
      <MemoryRouter>
        <VulnTable items={items} filters={noFilters} onFiltersChange={vi.fn()} server={server} />
      </MemoryRouter>,
    );
    return server;
  }

  it('desenha a página recebida na ordem do servidor e mostra a posição no total', () => {
    renderTable();
    expect(rowIds()).toEqual(items.map((v) => v.id));
    expect(screen.getByRole('navigation', { name: 'Paginação' })).toHaveTextContent('21–40 de 45');
  });

  it('próxima página e tamanho da página vão para o servidor', async () => {
    const user = userEvent.setup();
    const server = renderTable();
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(server.onPageChange).toHaveBeenCalledWith(3);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Itens por página' }), '50');
    expect(server.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('clicar no cabeçalho pede a ordenação ao servidor (asc → desc → nenhuma)', async () => {
    const user = userEvent.setup();
    const sortButton = () => within(screen.getByRole('columnheader', { name: /CVSS/ })).getByRole('button');

    const semOrdem = renderTable();
    await user.click(sortButton());
    expect(semOrdem.onSortChange).toHaveBeenLastCalledWith({ key: 'cvss', direction: 'asc' });
  });

  it('marca aria-sort pela ordenação do servidor e a desliga no terceiro clique', async () => {
    const user = userEvent.setup();
    const server = renderTable({ sort: { key: 'cvss', direction: 'desc' } });
    expect(screen.getByRole('columnheader', { name: /CVSS/ })).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(screen.getByRole('columnheader', { name: /CVSS/ })).getByRole('button'));
    expect(server.onSortChange).toHaveBeenLastCalledWith(null);
  });
});

describe('VulnListPage com paginação no servidor', () => {
  it('troca de página sem repetir linhas e começa pelas mais graves', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, 'listVulnerabilities');
    renderAt('/vulnerabilities', 'analyst', <VulnListPage />);
    await screen.findAllByTestId('vuln-row');
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), {
      page: 1,
      pageSize: 20,
      sort: { key: 'severity', direction: 'asc' },
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Itens por página' }), '10');
    await waitFor(() => expect(screen.getAllByTestId('vuln-row')).toHaveLength(10));
    const first = rowIds();
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('vuln-row')).toHaveLength(MOCK_VULNERABILITIES.length - 10),
    );
    const second = rowIds();
    expect(second.filter((id) => first.includes(id))).toEqual([]);
    expect([...first, ...second].sort()).toEqual(MOCK_VULNERABILITIES.map((v) => v.id).sort());
    expect(spy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });
});

describe('card dos ativos de maior risco', () => {
  it('lista até 5 ativos, da maior nota para a menor, com link para as vulnerabilidades do host', async () => {
    renderAt('/dashboard', 'analyst', <DashboardPage />);
    const card = await screen.findByTestId('top-risk-assets');
    const rows = within(card).getAllByTestId('top-risk-asset');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    const assets = await mockApi.listAssets();
    const scores = rows.map((row) => Number(row.textContent?.match(/(\d+)\/100/)?.[1]));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const top = assets.reduce((best, a) => ((a.riskScore ?? 0) > (best.riskScore ?? 0) ? a : best));
    const link = within(rows[0]!).getByRole('link');
    expect(link).toHaveTextContent(top.name);
    expect(link).toHaveAttribute('href', `/vulnerabilities?q=${encodeURIComponent(top.host)}`);
    expect(scores[0]).toBe(top.riskScore);
  });

  it('a nota segue a fórmula: 10/7/4/1 por aberta, teto 100', () => {
    expect(mockRiskScore({ critical: 1, high: 1, medium: 1, low: 1, info: 3 })).toBe(22);
    expect(mockRiskScore({ critical: 11, high: 0, medium: 0, low: 0, info: 0 })).toBe(100);
  });

  it('o Colaborador não vê o card (lista técnica)', async () => {
    renderAt('/dashboard', 'collaborator', <DashboardPage />);
    await screen.findAllByRole('meter');
    expect(screen.queryByText('Ativos de maior risco')).not.toBeInTheDocument();
  });
});

describe('aba Histórico do detalhe', () => {
  function vuln(patch: Partial<Vulnerability>): Vulnerability {
    return {
      ...MOCK_VULNERABILITIES[0]!,
      status: 'remediating',
      history: [
        {
          id: 'h-detectado',
          at: '2026-10-01T10:00:00.000Z',
          action: 'detected',
          note: 'Varredura do ativo Portal (10.0.0.5).',
        },
        {
          id: 'h-1',
          at: '2026-10-02T10:00:00.000Z',
          action: 'status_changed',
          from: 'in_review',
          to: 'remediating',
          actor: 'Analista de Segurança',
        },
      ],
      ...patch,
    };
  }

  async function openHistory(v: Vulnerability) {
    vi.spyOn(mockApi, 'getVulnerability').mockResolvedValue(v);
    const user = userEvent.setup();
    renderAt(
      `/vulnerabilities/${v.id}`,
      'analyst',
      <Routes>
        <Route path="/vulnerabilities/:id" element={<VulnDetailPage />} />
      </Routes>,
    );
    await user.click(await screen.findByRole('tab', { name: /Histórico/ }));
    return screen.getByTestId('vuln-history');
  }

  it('mostra só os fatos: a detecção (sem autor nem status inventado), a mudança registrada e o status atual', async () => {
    const list = await openHistory(vuln({ historyComplete: true }));
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Status alterado');
    expect(items[0]).toHaveTextContent('Em revisão → Em remediação');
    expect(items[0]).toHaveTextContent('por Analista de Segurança');
    expect(items[1]).toHaveTextContent('Detectada pela varredura');
    expect(items[1]).toHaveTextContent('Varredura do ativo Portal (10.0.0.5).');
    expect(items[1]).not.toHaveTextContent('por ');
    expect(items[1]).not.toHaveTextContent('→');
    expect(screen.getByText(/Status atual/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('avisa quando os registros não explicam o status atual', async () => {
    await openHistory(vuln({ historyComplete: false }));
    expect(screen.getByRole('note')).toHaveTextContent('Histórico incompleto');
  });
});
