import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import {
  CircularGauge,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  Pagination,
  SeverityBadge,
  Sidebar,
  StatusPill,
  Tabs,
  Topbar,
  type TabItem,
} from '@/components';
import {
  CAMPAIGN_STATUS_CLASS,
  CAMPAIGN_STATUS_DOT_CLASS,
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  severityFromRisk,
} from '@/lib/severity';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_USERS } from '@/mocks/data';
import { useUiStore } from '@/store/uiStore';

// Contratos de acessibilidade e comportamento dos componentes compartilhados.

type Session = NonNullable<AuthProviderProps['initialSession']>;

const USER_ID_BY_ROLE: Record<RBACRole, string> = {
  admin: 'u-000',
  analyst: 'u-001',
  collaborator: 'u-002',
};

function authenticatedSession(role: RBACRole): Session {
  const found = MOCK_USERS.find((candidate) => candidate.id === USER_ID_BY_ROLE[role]);
  if (!found) throw new Error(`Usuário mock não encontrado para o perfil ${role}`);
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated', token, user };
}

// ---- Tabs -------------------------------------------------------------------

const TAB_ITEMS: TabItem[] = [
  { id: 'overview', label: 'Visão geral', content: <p>Conteúdo da visão geral</p> },
  { id: 'evidence', label: 'Evidências', content: <p>Conteúdo das evidências</p>, count: 3 },
  { id: 'history', label: 'Histórico', content: <p>Conteúdo do histórico</p> },
];

function tabAt(index: number): HTMLElement {
  const tab = screen.getAllByRole('tab')[index];
  if (!tab) throw new Error(`Aba ${index} não encontrada`);
  return tab;
}

describe('Tabs', () => {
  it('seleciona por clique, marca aria-selected e renderiza apenas o painel ativo', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={TAB_ITEMS} onChange={onChange} aria-label="Detalhes da vulnerabilidade" />);

    expect(screen.getByRole('tablist', { name: 'Detalhes da vulnerabilidade' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(tabAt(0)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByText('Conteúdo da visão geral')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo das evidências')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Evidências/ }));

    expect(onChange).toHaveBeenCalledWith('evidence');
    expect(tabAt(1)).toHaveAttribute('aria-selected', 'true');
    expect(tabAt(0)).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByText('Conteúdo das evidências')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo da visão geral')).not.toBeInTheDocument();

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tabAt(1).id);
    expect(tabAt(1)).toHaveAttribute('aria-controls', panel.id);
    expect(within(tabAt(1)).getByText('3')).toBeInTheDocument();
  });

  it('navega com ArrowRight/ArrowLeft, Home e End movendo foco e seleção (tabindex rotativo)', async () => {
    const user = userEvent.setup();
    render(<Tabs items={TAB_ITEMS} />);

    tabAt(0).focus();
    await user.keyboard('{ArrowRight}');
    expect(tabAt(1)).toHaveFocus();
    expect(tabAt(1)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Conteúdo das evidências')).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(tabAt(2)).toHaveFocus();
    expect(tabAt(2)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Conteúdo do histórico')).toBeInTheDocument();

    // Da última aba, ArrowRight volta para a primeira.
    await user.keyboard('{ArrowRight}');
    expect(tabAt(0)).toHaveFocus();
    expect(tabAt(0)).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(tabAt(2)).toHaveFocus();

    await user.keyboard('{Home}');
    expect(tabAt(0)).toHaveFocus();
    expect(tabAt(0)).toHaveAttribute('aria-selected', 'true');
    expect(tabAt(0)).toHaveAttribute('tabindex', '0');
    expect(tabAt(1)).toHaveAttribute('tabindex', '-1');
    expect(tabAt(2)).toHaveAttribute('tabindex', '-1');
  });

  it('pula abas desabilitadas na navegação por teclado e respeita defaultTab', async () => {
    const user = userEvent.setup();
    const items: TabItem[] = [TAB_ITEMS[0]!, { ...TAB_ITEMS[1]!, disabled: true }, TAB_ITEMS[2]!];
    render(<Tabs items={items} defaultTab="history" />);

    expect(tabAt(2)).toHaveAttribute('aria-selected', 'true');
    expect(tabAt(1)).toBeDisabled();

    tabAt(2).focus();
    await user.keyboard('{ArrowLeft}');
    expect(tabAt(0)).toHaveFocus();
    expect(tabAt(0)).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(tabAt(2)).toHaveFocus();
  });

  it('em modo controlado não muda sozinho: só avisa onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={TAB_ITEMS} value="overview" onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /Histórico/ }));

    expect(onChange).toHaveBeenCalledWith('history');
    expect(tabAt(0)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Conteúdo da visão geral')).toBeInTheDocument();
  });
});

// ---- CircularGauge ----------------------------------------------------------

describe('CircularGauge', () => {
  it.each([
    [150, 100],
    [-5, 0],
    [42.4, 42],
    [Number.NaN, 0],
  ])('valor %s vira aria-valuenow %s (0–100)', (value, expected) => {
    render(<CircularGauge value={value} label="Risco técnico" />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-label', 'Risco técnico');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuenow', String(expected));
  });

  it.each([0, 24, 25, 49, 50, 74, 75, 100])('data-severity de %s segue severityFromRisk', (value) => {
    render(<CircularGauge value={value} label="Risco humano" colorScheme="human" />);

    const severity = severityFromRisk(value);
    const figure = screen.getByTestId('circular-gauge');
    expect(figure).toHaveAttribute('data-severity', severity);
    expect(figure).toHaveAttribute('data-color-scheme', 'human');
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      `${value}% — ${SEVERITY_LABEL[severity]}`,
    );
    expect(within(figure).getByText(SEVERITY_LABEL[severity])).toBeInTheDocument();
  });

  it('higherIsBetter inverte a escala e mantém o valor exibido', () => {
    render(<CircularGauge value={90} label="Resiliência" higherIsBetter sublabel="Sem cliques" />);

    expect(screen.getByTestId('circular-gauge')).toHaveAttribute('data-severity', severityFromRisk(10));
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '90');
    expect(screen.getByText('Sem cliques')).toBeInTheDocument();
  });
});

// ---- EmptyState / ErrorState ------------------------------------------------

describe('EmptyState e ErrorState', () => {
  it('EmptyState neutro com ação primária (onClick) e secundária (link)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <EmptyState
          title="Nenhum ativo cadastrado"
          description="Cadastre o primeiro ativo para iniciar as varreduras."
          action={{ label: 'Cadastrar ativo', onClick }}
          secondaryAction={{ label: 'Ver dashboard', to: '/dashboard' }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-tone', 'neutral');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nenhum ativo cadastrado' })).toBeInTheDocument();
    expect(screen.getByText(/Cadastre o primeiro ativo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cadastrar ativo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Ver dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('status 403 vira "Acesso negado" com link para o dashboard e sem retry', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ErrorState status={403} onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-tone', 'forbidden');
    expect(screen.getByText(/Seu perfil não tem permissão/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('status 404 vira "Não encontrado" sem botão de retry', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ErrorState status={404} onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Não encontrado' })).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-tone', 'error');
    expect(screen.getByText(/não existe ou foi removido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('padrão: role="alert" e "Tentar novamente" chama onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ErrorState message="Falha simulada" onRetry={onRetry} />
      </MemoryRouter>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar os dados');
    expect(alert).toHaveTextContent('Falha simulada');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retrying desabilita o botão; sem onRetry não há ação', () => {
    const { rerender } = render(
      <MemoryRouter>
        <ErrorState onRetry={() => undefined} retrying />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Tentar novamente/ })).toBeDisabled();

    rerender(
      <MemoryRouter>
        <ErrorState title="Erro ao salvar" message="Tente mais tarde." />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Erro ao salvar' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// ---- Pagination -------------------------------------------------------------

describe('Pagination', () => {
  it('mostra o intervalo, desabilita "Anterior" na primeira página e avança', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageSize={10} total={23} onPageChange={onPageChange} />);

    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(nav).toHaveTextContent('Exibindo 1–10 de 23');
    expect(nav).toHaveTextContent('1 / 3');
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('na última página desabilita "Próxima" e recua; página fora do intervalo é limitada', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={9} pageSize={10} total={23} onPageChange={onPageChange} />);

    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(nav).toHaveTextContent('Exibindo 21–23 de 23');
    expect(nav).toHaveTextContent('3 / 3');
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('lista vazia: "0–0 de 0", uma única página e ambos os botões desabilitados', () => {
    render(<Pagination page={1} pageSize={10} total={0} onPageChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(nav).toHaveTextContent('Exibindo 0–0 de 0');
    expect(nav).toHaveTextContent('1 / 1');
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  });

  it('só exibe o seletor "Itens por página" quando onPageSizeChange é informado', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={10} total={23} onPageChange={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Itens por página' })).not.toBeInTheDocument();

    rerender(
      <Pagination
        page={1}
        pageSize={10}
        total={23}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Itens por página' }), '25');
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });
});

// ---- StatusPill / SeverityBadge --------------------------------------------

describe('StatusPill e SeverityBadge', () => {
  it('StatusPill aplica colorClass, ponto decorativo e ícone', () => {
    render(
      <StatusPill
        label="Ativa"
        colorClass={CAMPAIGN_STATUS_CLASS.active}
        dotClass={CAMPAIGN_STATUS_DOT_CLASS.active}
        icon={<svg data-testid="pill-icon" aria-hidden="true" />}
        data-testid="pill"
      />,
    );

    const pill = screen.getByTestId('pill');
    expect(pill).toHaveTextContent('Ativa');
    expect(pill).toHaveClass(...CAMPAIGN_STATUS_CLASS.active.split(' '));
    const dot = pill.querySelector(`.${CAMPAIGN_STATUS_DOT_CLASS.active}`);
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(within(pill).getByTestId('pill-icon')).toBeInTheDocument();
  });

  it('StatusPill em tamanho md usa texto maior', () => {
    render(<StatusPill label="Pendente" colorClass="x" size="md" data-testid="pill" />);
    expect(screen.getByTestId('pill')).toHaveClass('text-sm');
  });

  it('SeverityBadge com rótulo alternativo mantém o tom da severidade', () => {
    render(<SeverityBadge severity="info" label="Analista" />);

    const badge = screen.getByTestId('severity-badge');
    expect(badge).toHaveTextContent('Analista');
    expect(badge).not.toHaveTextContent(SEVERITY_LABEL.info);
    expect(badge).toHaveAttribute('data-severity', 'info');
    expect(badge).toHaveClass(...SEVERITY_BADGE_CLASS.info.split(' '));
  });
});

// ---- FormErrorBanner --------------------------------------------------------

describe('FormErrorBanner', () => {
  it('não renderiza nada sem mensagem', () => {
    const { container, rerender } = render(<FormErrorBanner />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FormErrorBanner message="" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renderiza role="alert" com a mensagem e as cores do mapa de severidade', () => {
    render(<FormErrorBanner id="login-error" message="E-mail ou senha inválidos" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('E-mail ou senha inválidos');
    expect(alert).toHaveAttribute('id', 'login-error');
    expect(alert).toHaveAttribute('data-testid', 'form-error');
    expect(alert).toHaveClass(...SEVERITY_BADGE_CLASS.critical.split(' '));
  });
});

// ---- Sidebar (gaveta mobile) ------------------------------------------------

describe('Sidebar — gaveta mobile', () => {
  function renderShell(role: RBACRole) {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider initialSession={authenticatedSession(role)} revalidateOnMount={false}>
          <Sidebar />
          <Topbar />
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  afterEach(() => {
    // O store é um singleton de módulo: garante a gaveta fechada para o próximo teste.
    act(() => useUiStore.setState({ mobileSidebarOpen: false }));
  });

  it('abre pelo botão "Abrir menu", move o foco para dentro e fecha com Escape devolvendo o foco', async () => {
    const user = userEvent.setup();
    renderShell('analyst');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'Abrir menu' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Menu de navegação' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // Itens por perfil também valem dentro da gaveta.
    expect(within(dialog).getByRole('link', { name: 'Vulnerabilidades' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('prende o foco: Tab no último focável volta ao primeiro e Shift+Tab faz o inverso', async () => {
    const user = userEvent.setup();
    renderShell('admin');

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu de navegação' });
    // O primeiro focável do painel é o "Fechar menu" do cabeçalho (o do fundo escurecido fica fora do painel).
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Fechar menu' });
    const first = closeButtons[closeButtons.length - 1];
    const last = within(dialog).getByRole('button', { name: 'Sair' });
    if (!first) throw new Error('Botão "Fechar menu" do painel não encontrado');

    expect(first).toHaveFocus();
    last.focus();
    await user.tab();
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('o botão "Fechar menu" do painel fecha a gaveta', async () => {
    const user = userEvent.setup();
    renderShell('collaborator');

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu de navegação' });
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Fechar menu' });
    await user.click(closeButtons[closeButtons.length - 1]!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
