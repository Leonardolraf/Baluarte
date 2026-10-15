import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TermsPage from '@/pages/Account/TermsPage';
import { HttpError } from '@/lib/errors';
import { toTerms } from '@/services/adapters';
import { configureMocks, mockApi, resetMockState } from '@/mocks/api';
import { MOCK_CREDENTIALS } from '@/mocks/data';
import { tokenStorage, userStorage } from '@/lib/storage';

// Melhorias #5 — aceite dos termos de uso.

async function entrar(email = 'colaborador@empresa.com') {
  const cred = MOCK_CREDENTIALS.find((c) => c.email === email)!;
  const r = await mockApi.login({ email: cred.email, password: cred.password });
  tokenStorage.set(r.token);
  userStorage.set(r.user);
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={['/termos']}>
      <TermsPage />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
  await entrar();
});

afterEach(() => {
  vi.restoreAllMocks();
  tokenStorage.clear();
  userStorage.clear();
});

describe('adapter dos termos', () => {
  it('converte os campos da API', () => {
    expect(
      toTerms({
        versao: 'v1',
        rascunho: false,
        texto: 'Texto',
        aceito: true,
        aceitoEm: '2026-10-14T12:00:00.000Z',
      }),
    ).toEqual({
      version: 'v1',
      draft: false,
      text: 'Texto',
      accepted: true,
      acceptedAt: '2026-10-14T12:00:00.000Z',
    });
  });

  it('sem o campo `rascunho`, trata como rascunho (lado seguro)', () => {
    const raw = { versao: 'v1', texto: 'x', aceito: false, aceitoEm: null } as unknown as Parameters<
      typeof toTerms
    >[0];
    expect(toTerms(raw).draft).toBe(true);
  });
});

describe('tela de termos', () => {
  it('avisa que o texto é provisório enquanto for rascunho', async () => {
    renderizar();
    expect(await screen.findByTestId('termos-rascunho')).toHaveTextContent('Texto provisório');
    expect(screen.getByTestId('termos-texto')).toHaveTextContent('pendente de aprovação');
  });

  it('não aceita sem marcar a caixa, e aceita depois de marcar', async () => {
    renderizar();
    const botao = await screen.findByTestId('termos-aceitar');
    expect(botao).toBeDisabled();

    fireEvent.click(screen.getByTestId('termos-checkbox'));
    expect(botao).toBeEnabled();
    fireEvent.click(botao);

    await waitFor(async () => {
      const termos = await mockApi.getTerms();
      expect(termos.accepted).toBe(true);
    });
  });

  it('o aceite é idempotente: a segunda chamada não cria registro novo', async () => {
    const primeiro = await mockApi.acceptTerms('2026-10-14-rascunho');
    const segundo = await mockApi.acceptTerms('2026-10-14-rascunho');
    expect(primeiro.isNew).toBe(true);
    expect(segundo.isNew).toBe(false);
    expect(segundo.acceptedAt).toBe(primeiro.acceptedAt);
  });

  it('versão desatualizada (409) desmarca a caixa e pede releitura, sem registrar aceite', async () => {
    vi.spyOn(mockApi, 'acceptTerms').mockRejectedValue(
      new HttpError(409, 'VERSAO_DESATUALIZADA', 'Os termos mudaram'),
    );
    renderizar();
    fireEvent.click(await screen.findByTestId('termos-checkbox'));
    fireEvent.click(screen.getByTestId('termos-aceitar'));

    expect(await screen.findByRole('alert')).toHaveTextContent('mudaram enquanto você lia');
    await waitFor(() => expect(screen.getByTestId('termos-checkbox')).not.toBeChecked());
    // Sem aceite: o botão volta a ficar travado.
    expect(screen.getByTestId('termos-aceitar')).toBeDisabled();
  });

  it('a camada mock recusa versão fora do formato', async () => {
    await expect(mockApi.acceptTerms('versão inválida!')).rejects.toMatchObject({
      status: 400,
      code: 'VERSAO_INVALIDA',
    });
  });
});
