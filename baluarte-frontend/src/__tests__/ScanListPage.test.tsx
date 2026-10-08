import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { configureMocks, mockApi, resetMockState } from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';
import ScanListPage, { SCAN_POLL_MS } from '@/pages/Scans/ScanListPage';

function renderAsAnalyst() {
  const found = MOCK_USERS.find((u) => u.id === 'u-001')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return render(
    <MemoryRouter initialEntries={['/scans']}>
      <AuthProvider initialSession={{ status: 'authenticated', token, user }} revalidateOnMount={false}>
        <ScanListPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function rowOf(assetName: string): HTMLElement {
  const cell = screen.getAllByText(assetName).find((el) => el.closest('tr'));
  return cell!.closest('tr')!;
}

beforeEach(() => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ScanListPage (B21 + B26)', () => {
  it('inicia a varredura e acompanha o status sozinha até concluir', async () => {
    // Só o relógio e o intervalo são falsos; a latência simulada do mock segue real (0 ms nos testes).
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    const user = userEvent.setup();
    renderAsAnalyst();

    expect(await screen.findByText('Histórico')).toBeInTheDocument();
    const select = await screen.findByLabelText('Ativo');
    await screen.findByRole('option', { name: /srv-web-01/ });
    await user.selectOptions(select, screen.getByRole('option', { name: /srv-web-01/ }));
    await user.click(screen.getByRole('button', { name: /Iniciar varredura/ }));

    // A primeira linha de srv-web-01 é a nova (mais recente primeiro).
    await within(rowOf('srv-web-01')).findByText('Em fila');
    expect(screen.getByText(/Atualizando automaticamente/)).toBeInTheDocument();
    // O mesmo ativo não pode ser escolhido de novo enquanto a varredura corre.
    expect(screen.getByRole('option', { name: /srv-web-01.*em andamento/ })).toBeDisabled();

    vi.setSystemTime(new Date('2026-10-07T12:00:06Z'));
    await act(async () => {
      vi.advanceTimersByTime(SCAN_POLL_MS);
    });
    await within(rowOf('srv-web-01')).findByText('Em andamento');

    vi.setSystemTime(new Date('2026-10-07T12:00:21Z'));
    await act(async () => {
      vi.advanceTimersByTime(SCAN_POLL_MS);
    });
    const row = rowOf('srv-web-01');
    await within(row).findByText('Concluída');
    expect(within(row).getByText('20 s')).toBeInTheDocument();
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('/vulnerabilities?q='),
    );
  });

  it('mostra progresso, etapa e tempo estimado, consulta só as varreduras em curso e avisa a conclusão (B26)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    const getScan = vi.spyOn(mockApi, 'getScan');
    const listScans = vi.spyOn(mockApi, 'listScans');
    const user = userEvent.setup();
    renderAsAnalyst();

    expect(await screen.findByText('Histórico')).toBeInTheDocument();
    await screen.findByRole('option', { name: /portal-cliente/ });
    await user.selectOptions(
      screen.getByLabelText('Ativo'),
      screen.getByRole('option', { name: /portal-cliente/ }),
    );
    await user.click(screen.getByRole('button', { name: /Iniciar varredura/ }));

    const bar = await within(rowOf('portal-cliente')).findByRole('progressbar', {
      name: 'Progresso da varredura de portal-cliente',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '0%, Na fila');
    expect(within(rowOf('portal-cliente')).getByText('Na fila')).toBeInTheDocument();
    expect(within(rowOf('portal-cliente')).getByText('≈ 20 s')).toBeInTheDocument();
    const listCallsBefore = listScans.mock.calls.length;

    // Meio do andamento: 50%, terceira etapa, ≈ 8 s para concluir. O relógio falso também anda
    // com advanceTimersByTime: 09,5 s + o intervalo de 3 s = 12,5 s depois do início.
    vi.setSystemTime(new Date('2026-10-07T12:00:09.500Z'));
    await act(async () => {
      vi.advanceTimersByTime(SCAN_POLL_MS);
    });
    await within(rowOf('portal-cliente')).findByText('Testando autenticação');
    expect(within(rowOf('portal-cliente')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(within(rowOf('portal-cliente')).getByText('50%')).toBeInTheDocument();
    expect(within(rowOf('portal-cliente')).getByText('≈ 8 s')).toBeInTheDocument();
    // A consulta automática pede só as varreduras em curso (a nova e a longa do seed), não a lista.
    const polledIds = new Set(getScan.mock.calls.map(([id]) => id));
    expect(polledIds.has('scan-005')).toBe(true);
    expect(polledIds.size).toBe(2);
    expect(listScans.mock.calls.length).toBe(listCallsBefore);

    vi.setSystemTime(new Date('2026-10-07T12:00:21Z'));
    await act(async () => {
      vi.advanceTimersByTime(SCAN_POLL_MS);
    });
    const notices = screen.getByTestId('scan-completed-notices');
    expect(notices).toHaveAttribute('role', 'status');
    await within(notices).findByText(/concluída/);
    expect(notices).toHaveTextContent(/Varredura de portal-cliente concluída: \d+ achados\./);
    expect(within(notices).getByRole('link', { name: /Ver achados/ })).toHaveAttribute(
      'href',
      `/vulnerabilities?q=${encodeURIComponent('portal.empresa.com')}`,
    );
    const row = rowOf('portal-cliente');
    expect(within(row).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(row).getByText('100%')).toBeInTheDocument();
    expect(within(row).getByText('Concluída')).toBeInTheDocument();
  });

  it('falha pontual na consulta de uma varredura mantém a linha e a próxima rodada atualiza', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    const user = userEvent.setup();
    renderAsAnalyst();
    await screen.findByRole('option', { name: /api-pagamentos/ });
    await user.selectOptions(
      screen.getByLabelText('Ativo'),
      screen.getByRole('option', { name: /api-pagamentos/ }),
    );
    await user.click(screen.getByRole('button', { name: /Iniciar varredura/ }));
    await within(rowOf('api-pagamentos')).findByText('Na fila');

    const getScan = vi.spyOn(mockApi, 'getScan').mockRejectedValue(new Error('rede'));
    // 02 s + 3 s do intervalo = 5 s (a consulta falha); mais 3 s = 8 s, primeira etapa.
    vi.setSystemTime(new Date('2026-10-07T12:00:02Z'));
    await act(async () => {
      vi.advanceTimersByTime(SCAN_POLL_MS);
    });
    expect(getScan).toHaveBeenCalled();
    expect(within(rowOf('api-pagamentos')).getByText('Na fila')).toBeInTheDocument();

    getScan.mockRestore();
    await act(async () => {
      vi.advanceTimersByTime(SCAN_POLL_MS);
    });
    await within(rowOf('api-pagamentos')).findByText('Mapeando superfície');
  });

  it('não oferece ativo com varredura em andamento e pede o ativo antes de iniciar', async () => {
    const user = userEvent.setup();
    renderAsAnalyst();
    // db-central (asset-005) já tem varredura "Em andamento" no seed: a opção vem desabilitada.
    const option = await screen.findByRole('option', { name: /db-central.*em andamento/ });
    expect(option).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Iniciar varredura/ }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Selecione o ativo');
  });
});
