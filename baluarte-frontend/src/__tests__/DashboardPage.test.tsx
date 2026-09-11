import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, DashboardMetrics, RBACRole } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { formatNumber } from '@/lib/format';
import { tokenStorage, userStorage } from '@/lib/storage';
import { configureMocks, mockApi } from '@/mocks/api';
import { MOCK_USERS, MOCK_VULNERABILITIES } from '@/mocks/data';
import DashboardPage from '@/pages/Dashboard/DashboardPage';

type Session = NonNullable<AuthProviderProps['initialSession']>;

const USER_ID_BY_ROLE: Record<RBACRole, string> = {
  admin: 'u-000',
  analyst: 'u-001',
  collaborator: 'u-002',
};

const KPI_LABELS = [
  'Vulnerabilidades abertas',
  'Críticas',
  'Ativos monitorados',
  'Campanhas ativas',
  'Colaboradores treinados',
  'Resiliência a phishing',
];

const SECTION_TITLES = [
  'Vulnerabilidades recentes',
  'Distribuição por severidade',
  'Campanhas recentes',
  'Ameaças recentes',
];

function authenticatedSession(role: RBACRole): Session {
  const found = MOCK_USERS.find((candidate) => candidate.id === USER_ID_BY_ROLE[role]);
  if (!found) throw new Error(`Usuário mock não encontrado para o perfil ${role}`);
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated', token, user };
}

function renderDashboard(role: RBACRole) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider initialSession={authenticatedSession(role)} revalidateOnMount={false}>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function statCard(label: string): HTMLElement {
  const card = screen
    .getAllByTestId('stat-card')
    .find((element) => within(element).queryByText(label) !== null);
  if (!card) throw new Error(`StatCard "${label}" não encontrado`);
  return card;
}

/** Substitui a resposta do dashboard mock por uma variação da resposta real (a fachada `api` consulta `mockApi` a cada chamada). */
function overrideDashboard(patch: (metrics: DashboardMetrics) => DashboardMetrics) {
  const original = mockApi.getDashboard.bind(mockApi);
  vi.spyOn(mockApi, 'getDashboard').mockImplementation(async () => patch(await original()));
}

describe('DashboardPage', () => {
  it('renderiza os dois medidores de risco (role="meter") com valores entre 0 e 100', async () => {
    renderDashboard('admin');

    const meters = await screen.findAllByRole('meter');
    expect(meters).toHaveLength(2);

    const labels = meters.map((meter) => meter.getAttribute('aria-label'));
    expect(labels).toEqual(['Risco técnico', 'Risco humano']);

    for (const meter of meters) {
      const value = Number(meter.getAttribute('aria-valuenow'));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(meter).toHaveAttribute('aria-valuemin', '0');
      expect(meter).toHaveAttribute('aria-valuemax', '100');
    }
    expect(within(screen.getByTestId('risk-gauges')).getAllByTestId('circular-gauge')).toHaveLength(2);
  });

  it('renderiza os seis cards de indicadores e as quatro seções do painel', async () => {
    renderDashboard('admin');

    await screen.findAllByRole('meter');

    expect(screen.getByRole('heading', { name: 'Visão geral de risco' })).toBeInTheDocument();
    expect(screen.getAllByTestId('stat-card')).toHaveLength(KPI_LABELS.length);
    for (const label of KPI_LABELS) {
      expect(statCard(label)).toBeInTheDocument();
    }
    for (const title of SECTION_TITLES) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
  });

  it('mostra as contagens de vulnerabilidades abertas e críticas coerentes com o mock', async () => {
    renderDashboard('admin');

    await screen.findAllByRole('meter');

    const open = MOCK_VULNERABILITIES.filter(
      (vuln) => vuln.status !== 'resolved' && vuln.status !== 'accepted',
    );
    const critical = open.filter((vuln) => vuln.severity === 'critical');

    expect(
      within(statCard('Vulnerabilidades abertas')).getByText(formatNumber(open.length)),
    ).toBeInTheDocument();
    expect(within(statCard('Críticas')).getByText(formatNumber(critical.length))).toBeInTheDocument();
    expect(screen.getAllByTestId('severity-badge').length).toBeGreaterThan(0);
  });

  it('para administrador, os indicadores gerenciais e os cards de lista são links ("Ver todas")', async () => {
    renderDashboard('admin');

    await screen.findAllByRole('meter');

    expect(statCard('Vulnerabilidades abertas').tagName).toBe('A');
    expect(statCard('Vulnerabilidades abertas')).toHaveAttribute('href', '/vulnerabilities');
    expect(statCard('Campanhas ativas')).toHaveAttribute('href', '/campaigns');
    const seeAll = screen.getAllByRole('link', { name: 'Ver todas' });
    expect(seeAll.map((link) => link.getAttribute('href'))).toEqual(['/vulnerabilities', '/campaigns']);
    expect(screen.queryByRole('link', { name: 'Ver todos' })).not.toBeInTheDocument();
  });

  it('para colaborador, exibe o treinamento pendente retornado pela API e não linka para áreas restritas', async () => {
    renderDashboard('collaborator');

    await screen.findAllByRole('meter');
    const { pendingTraining } = await mockApi.getDashboard();
    if (!pendingTraining) throw new Error('O mock deveria devolver um treinamento pendente');

    const card = screen.getByRole('heading', { name: 'Seu treinamento' }).closest('section');
    if (!card) throw new Error('Card "Seu treinamento" não encontrado');
    expect(within(card).getByText(pendingTraining.title)).toBeInTheDocument();
    expect(within(card).getByText(pendingTraining.moduleCode)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Iniciar treinamento' })).toHaveAttribute(
      'href',
      `/training/${pendingTraining.id}`,
    );

    expect(statCard('Vulnerabilidades abertas').tagName).toBe('DIV');
    expect(screen.queryByRole('link', { name: 'Ver todas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver todos' })).not.toBeInTheDocument();
  });

  it('para colaborador, oculta as listas técnicas vazias (vulnerabilidades e campanhas recentes)', async () => {
    renderDashboard('collaborator');

    await screen.findAllByRole('meter');

    expect(screen.queryByRole('heading', { name: 'Vulnerabilidades recentes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Campanhas recentes' })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('severity-badge')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Distribuição por severidade' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ameaças recentes' })).toBeInTheDocument();
  });

  it('para gestor com listas vazias, mantém os cards com estado vazio', async () => {
    overrideDashboard((metrics) => ({ ...metrics, recentFindings: [], recentCampaigns: [] }));
    renderDashboard('analyst');

    await screen.findAllByRole('meter');

    expect(screen.getByRole('heading', { name: 'Vulnerabilidades recentes' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma vulnerabilidade aberta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Campanhas recentes' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma campanha recente')).toBeInTheDocument();
  });

  it('não exibe o card de treinamento quando a API não devolve treinamento pendente', async () => {
    overrideDashboard((metrics) => ({ ...metrics, pendingTraining: null }));
    renderDashboard('collaborator');

    await screen.findAllByRole('meter');

    expect(screen.queryByRole('heading', { name: 'Seu treinamento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Iniciar treinamento' })).not.toBeInTheDocument();
  });

  it('mostra "—" e "não medida" quando a resiliência a phishing é nula', async () => {
    overrideDashboard((metrics) => ({
      ...metrics,
      humanRisk: 0,
      kpis: { ...metrics.kpis, phishingResilience: null },
    }));
    renderDashboard('admin');

    const meters = await screen.findAllByRole('meter');
    expect(meters).toHaveLength(2);

    const resilience = statCard('Resiliência a phishing');
    expect(within(resilience).getByText('—')).toBeInTheDocument();
    expect(within(resilience).getByText('Sem campanhas disparadas')).toBeInTheDocument();
    expect(screen.getByText('Resiliência a phishing: não medida')).toBeInTheDocument();
  });

  it('mostra estado de erro com "Tentar novamente" e recupera após o retry', async () => {
    const user = userEvent.setup();
    configureMocks({ failureRate: 1 });
    renderDashboard('analyst');

    const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os dados');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    configureMocks({ failureRate: 0 });
    await user.click(retry);

    expect(await screen.findAllByRole('meter')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });
});
