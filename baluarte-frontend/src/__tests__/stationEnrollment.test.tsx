import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components';
import { buildMockToken } from '@/lib/jwt';
import { HttpError } from '@/lib/errors';
import { ROUTE_ROLES } from '@/lib/roles';
import { tokenStorage, userStorage } from '@/lib/storage';
import { enrollmentStateKey } from '@/lib/stationEnrollment';
import { mockApi, resetMockState } from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';
import {
  fromStationEnrollmentInput,
  toStationEnrollment,
  toStationEnrollmentCode,
} from '@/services/adapters';
import StationEnrollmentPage from '@/pages/Stations/StationEnrollmentPage';
import StationListPage from '@/pages/Stations/StationListPage';

// #9 — tela "Vincular estação": o Administrador gera o código de uso único do instalador do
// agente, vê os códigos emitidos e revoga o que ainda não foi usado.

const CODE_FORMAT = /^BLT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

function session(role: RBACRole) {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated' as const, token, user };
}

function renderAt(path: string, role: RBACRole = 'admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={session(role)} revalidateOnMount={false}>
        <Routes>
          <Route path="/stations" element={<StationListPage />} />
          <Route element={<ProtectedRoute roles={ROUTE_ROLES.stationEnrollment} />}>
            <Route path="/stations/enroll" element={<StationEnrollmentPage />} />
          </Route>
          <Route path="/403" element={<p>Acesso negado</p>} />
          <Route path="/dashboard" element={<p>Painel</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adapters do vínculo', () => {
  it('converte a emissão, a lista e o corpo do POST', () => {
    expect(
      toStationEnrollmentCode({
        idVinculo: 'v1',
        codigo: 'BLT-AAAA-BBBB-CCCC',
        expiraEm: '2026-11-26T10:00:00.000Z',
      }),
    ).toEqual({ id: 'v1', code: 'BLT-AAAA-BBBB-CCCC', expiresAt: '2026-11-26T10:00:00.000Z' });

    const base = {
      idVinculo: 'v2',
      nome: 'Notebook',
      host: null,
      criadoEm: '2026-11-25T10:00:00.000Z',
      expiraEm: '2026-11-26T10:00:00.000Z',
      assetId: null,
    };
    expect(toStationEnrollment({ ...base, estado: 'pendente' }).state).toBe('pending');
    expect(toStationEnrollment({ ...base, estado: 'consumido' }).state).toBe('consumed');
    expect(toStationEnrollment({ ...base, estado: 'expirado' }).state).toBe('expired');
    // Estado novo do servidor não vira "pendente" (que ofereceria revogar) nem "expirado".
    expect(toStationEnrollment({ ...base, estado: 'outro' }).state).toBe('unknown');

    expect(fromStationEnrollmentInput({ name: '  Notebook  ', host: ' ', description: '' })).toEqual({
      nome: 'Notebook',
    });
    expect(fromStationEnrollmentInput({ name: 'N', host: 'nb-01', description: 'Demo' })).toEqual({
      nome: 'N',
      host: 'nb-01',
      descricao: 'Demo',
    });
  });

  it('separa "usado" (com estação) de "encerrado" (revogado, sem estação)', () => {
    expect(enrollmentStateKey({ state: 'consumed', assetId: 'a1' })).toBe('used');
    expect(enrollmentStateKey({ state: 'consumed', assetId: null })).toBe('closed');
    expect(enrollmentStateKey({ state: 'pending', assetId: null })).toBe('pending');
  });
});

describe('camada mock do vínculo', () => {
  it('só o Administrador emite, lista e revoga', async () => {
    session('analyst');
    await expect(mockApi.createStationEnrollment({ name: 'X' })).rejects.toMatchObject({ status: 403 });
    await expect(mockApi.listStationEnrollments()).rejects.toMatchObject({ status: 403 });
  });

  it('emite um código no formato do instalador e revoga uma vez só', async () => {
    session('admin');
    const issued = await mockApi.createStationEnrollment({ name: 'Notebook' });
    expect(issued.code).toMatch(CODE_FORMAT);
    const list = await mockApi.listStationEnrollments();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: issued.id, name: 'Notebook', state: 'pending' });
    // A lista nunca traz o código.
    expect(JSON.stringify(list)).not.toContain(issued.code);

    await mockApi.revokeStationEnrollment(issued.id);
    expect((await mockApi.listStationEnrollments()).items[0].state).toBe('consumed');
    await expect(mockApi.revokeStationEnrollment(issued.id)).rejects.toMatchObject({
      status: 409,
      code: 'VINCULO_JA_CONSUMIDO',
    });
  });

  it('recusa nome vazio', async () => {
    session('admin');
    await expect(mockApi.createStationEnrollment({ name: '   ' })).rejects.toMatchObject({
      status: 400,
      code: 'NOME_INVALIDO',
    });
  });
});

describe('StationEnrollmentPage', () => {
  it('gera o código, mostra a validade e lista como "Aguardando instalação"', async () => {
    const user = userEvent.setup();
    renderAt('/stations/enroll');
    expect(await screen.findByText('Nenhum código emitido')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nome da estação/), 'Notebook da apresentação');
    await user.type(screen.getByLabelText(/Host/), 'notebook-demo.local');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));

    const card = await screen.findByTestId('enrollment-issued');
    expect(within(card).getByTestId('enrollment-code').textContent).toMatch(CODE_FORMAT);
    expect(within(card).getByText(/Para a estação “Notebook da apresentação”/)).toBeInTheDocument();
    expect(within(card).getByText(/não é mostrado de novo/)).toBeInTheDocument();
    // O formulário limpa para o próximo código.
    expect(screen.getByLabelText(/Nome da estação/)).toHaveValue('');

    const row = await screen.findByTestId('enrollment-row');
    expect(within(row).getByText('Notebook da apresentação')).toBeInTheDocument();
    expect(within(row).getByText('notebook-demo.local')).toBeInTheDocument();
    expect(within(row).getByText('Aguardando instalação')).toBeInTheDocument();
  });

  it('não chama a API sem nome e mostra o erro no campo', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, 'createStationEnrollment');
    renderAt('/stations/enroll');
    await screen.findByText('Nenhum código emitido');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText('Informe o nome da estação.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('leva o erro de host da API para o campo', async () => {
    const user = userEvent.setup();
    vi.spyOn(mockApi, 'createStationEnrollment').mockRejectedValue(
      new HttpError(400, 'HOST_INVALIDO', 'Host inválido'),
    );
    renderAt('/stations/enroll');
    await screen.findByText('Nenhum código emitido');
    await user.type(screen.getByLabelText(/Nome da estação/), 'NB');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText('Host inválido')).toBeInTheDocument();
    expect(screen.queryByTestId('enrollment-issued')).not.toBeInTheDocument();
  });

  it('revoga um código pendente depois de confirmar e esconde o cartão dele', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/stations/enroll');
    await screen.findByText('Nenhum código emitido');
    await user.type(screen.getByLabelText(/Nome da estação/), 'NB-01');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    await screen.findByTestId('enrollment-issued');

    await user.click(await screen.findByRole('button', { name: 'Revogar o código da estação NB-01' }));
    expect(await screen.findByText('Encerrado')).toBeInTheDocument();
    expect(screen.queryByTestId('enrollment-issued')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revogar/ })).not.toBeInTheDocument();
  });

  it('não revoga quando o Administrador cancela a confirmação', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const spy = vi.spyOn(mockApi, 'revokeStationEnrollment');
    renderAt('/stations/enroll');
    await screen.findByText('Nenhum código emitido');
    await user.type(screen.getByLabelText(/Nome da estação/), 'NB-02');
    await user.click(screen.getByRole('button', { name: 'Gerar código' }));
    await user.click(await screen.findByRole('button', { name: 'Revogar o código da estação NB-02' }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText('Aguardando instalação')).toBeInTheDocument();
  });

  it('o Analista não abre a tela', async () => {
    renderAt('/stations/enroll', 'analyst');
    expect(screen.queryByRole('heading', { name: 'Vincular estação' })).not.toBeInTheDocument();
  });
});

describe('botão "Vincular estação" na lista', () => {
  it('aparece para o Administrador e leva à tela', async () => {
    renderAt('/stations', 'admin');
    expect(await screen.findByRole('link', { name: 'Vincular estação' })).toHaveAttribute(
      'href',
      '/stations/enroll',
    );
  });

  it('não aparece para o Analista', async () => {
    renderAt('/stations', 'analyst');
    await screen.findAllByTestId('station-row');
    expect(screen.queryByRole('link', { name: 'Vincular estação' })).not.toBeInTheDocument();
  });
});
