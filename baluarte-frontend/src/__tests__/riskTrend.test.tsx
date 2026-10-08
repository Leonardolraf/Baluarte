import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser, RBACRole, RiskTrendPoint } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { configureMocks, mockApi, mockRiskScore, resetMockState } from '@/mocks/api';
import { MOCK_CREDENTIALS, MOCK_USERS } from '@/mocks/data';
import { RiskTrendChart } from '@/components/Chart/RiskTrendChart';
import DashboardPage from '@/pages/Dashboard/DashboardPage';

// B25b: evolução do risco em 30 dias (gráfico SVG próprio, acessível) e o índice de risco
// técnico vindo pronto do "servidor" (no modo mock, a camada mock faz o papel dele).

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

async function loginAs(role: RBACRole) {
  const user = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const cred = MOCK_CREDENTIALS.find((c) => c.userId === user.id)!;
  const response = await mockApi.login({ email: cred.email, password: cred.password });
  tokenStorage.set(response.token);
  userStorage.set(response.user);
}

/** 30 dias a partir de 09/09/2026: índice subindo de 10 em 10 até o dia 6 e estável depois. */
function points(): RiskTrendPoint[] {
  return Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 8, 9 + i)).toISOString().slice(0, 10);
    return {
      date: day,
      critical: i >= 20 ? 2 : 0,
      high: 1,
      medium: i % 2,
      low: 3,
      maliciousFiles: i === 29 ? 1 : 0,
      assets: 4,
      index: Math.min(60, i * 10),
    };
  });
}

beforeEach(() => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
});

describe('RiskTrendChart', () => {
  it('resumo, legenda (identidade não só pela cor), dois painéis com um eixo cada e a tabela com os 30 dias', () => {
    render(<RiskTrendChart points={points()} />);
    const summary = screen.getByTestId('risk-trend-summary');
    expect(summary).toHaveTextContent('Índice hoje: 60/100');
    expect(summary).toHaveTextContent('+60 desde 09/09');
    expect(summary).toHaveTextContent('7 vulnerabilidades abertas hoje (+3)');

    const legend = screen.getByRole('list', { name: 'Legenda' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Índice de risco técnico', 'Crítico', 'Alto', 'Médio', 'Baixo']);
    expect(screen.getByTestId('risk-trend-index').querySelectorAll('path[data-series]')).toHaveLength(1);
    expect(
      [...screen.getByTestId('risk-trend-severity').querySelectorAll('path[data-series]')].map((p) =>
        p.getAttribute('data-series'),
      ),
    ).toEqual(['critical', 'high', 'medium', 'low']);

    const rows = within(screen.getByTestId('risk-trend-table')).getAllByRole('row');
    expect(rows).toHaveLength(31); // cabeçalho + 30 dias
    // Mais recente primeiro; a data sai como veio (sem conversão de fuso que mudasse o dia).
    expect(rows[1]).toHaveTextContent('08/10/2026');
    expect(rows[1]).toHaveTextContent(/08\/10\/2026\s*60\s*2\s*1\s*1\s*3\s*1\s*4/);
    expect(rows[30]).toHaveTextContent('09/09/2026');
  });

  it('teclado: as setas percorrem os dias, a dica mostra o dia e o valor anunciado acompanha; Esc fecha', async () => {
    const user = userEvent.setup();
    render(<RiskTrendChart points={points()} />);
    const slider = screen.getByRole('slider', { name: /Dia da evolução do risco/ });
    expect(slider).toHaveAttribute('aria-valuenow', '30');
    expect(slider.getAttribute('aria-valuetext')).toContain('08/10/2026: índice 60 de 100');

    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('risk-trend-tooltip')).toHaveTextContent('08/10/2026');
    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '29');
    expect(screen.getByTestId('risk-trend-tooltip')).toHaveTextContent('07/10/2026');
    expect(slider.getAttribute('aria-valuetext')).toContain('07/10/2026');
    await user.keyboard('{Home}');
    expect(screen.getByTestId('risk-trend-tooltip')).toHaveTextContent('09/09/2026');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('risk-trend-tooltip')).not.toBeInTheDocument();
  });

  it('mouse: passar sobre o gráfico mostra o dia mais próximo; sair esconde', () => {
    render(<RiskTrendChart points={points()} />);
    const svg = screen.getByTestId('risk-trend-severity');
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 600,
      height: 132,
      right: 600,
      bottom: 132,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseMove(svg, { clientX: 590, clientY: 50 });
    const tooltip = screen.getByTestId('risk-trend-tooltip');
    expect(tooltip).toHaveTextContent('08/10/2026');
    expect(tooltip).toHaveTextContent('+ 1 arquivo com ameaça');
    fireEvent.mouseMove(svg, { clientX: 30, clientY: 50 });
    expect(screen.getByTestId('risk-trend-tooltip')).toHaveTextContent('09/09/2026');
    fireEvent.mouseLeave(svg);
    expect(screen.queryByTestId('risk-trend-tooltip')).not.toBeInTheDocument();
  });

  it('sem pontos não desenha nada', () => {
    const { container } = render(<RiskTrendChart points={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('dashboard (modo mock)', () => {
  function renderDashboard(role: RBACRole) {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider initialSession={session(role)} revalidateOnMount={false}>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('Analista vê o card de evolução com o índice de hoje igual ao medidor de risco técnico', async () => {
    renderDashboard('analyst');
    expect(await screen.findByText('Evolução do risco')).toBeInTheDocument();
    const d = await mockApi.getDashboard();
    expect(screen.getByTestId('risk-trend-summary')).toHaveTextContent(`Índice hoje: ${d.technicalRisk}/100`);
  });

  it('Colaborador não vê o card (dado técnico)', async () => {
    renderDashboard('collaborator');
    await screen.findAllByRole('meter');
    expect(screen.queryByText('Evolução do risco')).not.toBeInTheDocument();
  });
});

describe('mock como servidor: índice e evolução', () => {
  it('o índice usa os mesmos pesos da nota por ativo (10/7/4/1) e o último dia é o estado atual', async () => {
    await loginAs('admin');
    const d = await mockApi.getDashboard();
    const trend = d.riskTrend!;
    expect(trend).toHaveLength(30);
    const today = trend[29]!;
    const dist = d.severityDistribution!;
    expect(today.critical + today.maliciousFiles).toBe(dist.critical);
    expect([today.high, today.medium, today.low]).toEqual([dist.high, dist.medium, dist.low]);
    expect(today.index).toBe(d.technicalRisk);
    const assets = (await mockApi.listAssets()).length;
    const points = mockRiskScore({ ...dist, info: 0 });
    // mockRiskScore tem teto 100 nos pontos; com o seed os pontos ficam abaixo do teto.
    expect(d.technicalRisk).toBe(Math.min(100, Math.round((points / (Math.max(1, assets) * 20)) * 100)));
  });

  it('resolver hoje muda só o ponto de hoje', async () => {
    await loginAs('analyst');
    const before = (await mockApi.getDashboard()).riskTrend!;
    const open = (await mockApi.listVulnerabilities({ status: 'open' })).items[0]!;
    await mockApi.updateVulnerabilityStatus(open.id, 'resolved');
    const after = (await mockApi.getDashboard()).riskTrend!;
    expect(after.slice(0, 29)).toEqual(before.slice(0, 29));
    expect(openOf(after[29]!)).toBe(openOf(before[29]!) - 1);
  });

  it('Colaborador: índice e evolução null', async () => {
    await loginAs('collaborator');
    const d = await mockApi.getDashboard();
    expect(d.technicalRisk).toBeNull();
    expect(d.riskTrend).toBeNull();
  });
});

function openOf(p: RiskTrendPoint): number {
  return p.critical + p.high + p.medium + p.low;
}
