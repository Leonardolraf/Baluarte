import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
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

afterEach(() => {
  vi.useRealTimers();
});

describe('ScanListPage (B21)', () => {
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
