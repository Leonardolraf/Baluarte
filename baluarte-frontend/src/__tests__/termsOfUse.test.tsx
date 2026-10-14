import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/types';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { HttpError } from '@/lib/errors';
import { buildMockToken } from '@/lib/jwt';
import { clearSession, tokenStorage, userStorage } from '@/lib/storage';
import { mockApi, resetMockState } from '@/mocks/api';
import { MOCK_TERMS, MOCK_USERS } from '@/mocks/data';

// Termos de uso (Melhorias #5): a camada mock (ler e aceitar, idempotente e auditado) e a
// sessão, que NÃO cai quando a revalidação com /me volta 403 TERMOS_NAO_ACEITOS.

function sessionAs(id: string): { token: string; user: AuthUser } {
  const found = MOCK_USERS.find((u) => u.id === id)!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { token, user };
}

function Status() {
  const { status } = useAuth();
  return <p>status: {status}</p>;
}

beforeEach(() => resetMockState());
afterEach(() => {
  vi.restoreAllMocks();
  clearSession();
});

describe('mockApi — termos de uso', () => {
  it('contas do seed já aceitaram; o texto é o espaço reservado em rascunho', async () => {
    sessionAs('u-002');
    const terms = await mockApi.getTerms();
    expect(terms).toMatchObject({
      version: MOCK_TERMS.version,
      draft: true,
      text: MOCK_TERMS.text,
      accepted: true,
    });
    expect(terms.acceptedAt).not.toBeNull();
    expect(await mockApi.acceptTerms(MOCK_TERMS.version)).toMatchObject({
      created: false,
      acceptedAt: terms.acceptedAt,
    });
  });

  it('valida a versão como a API (400 formato, 409 desatualizada)', async () => {
    sessionAs('u-002');
    await expect(mockApi.acceptTerms('x y')).rejects.toMatchObject({ status: 400, code: 'VERSAO_INVALIDA' });
    await expect(mockApi.acceptTerms('1999-01-01')).rejects.toMatchObject({
      status: 409,
      code: 'VERSAO_DESATUALIZADA',
    });
  });
});

describe('AuthProvider — 403 TERMOS_NAO_ACEITOS na revalidação', () => {
  it('mantém a sessão (só falta aceitar os termos)', async () => {
    const { token, user } = sessionAs('u-002');
    const me = vi
      .spyOn(mockApi, 'me')
      .mockRejectedValue(new HttpError(403, 'TERMOS_NAO_ACEITOS', 'Aceite os termos de uso para continuar'));
    render(
      <AuthProvider initialSession={{ status: 'authenticated', token, user }}>
        <Status />
      </AuthProvider>,
    );
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(screen.getByText('status: authenticated')).toBeInTheDocument();
    expect(tokenStorage.get()).toBe(token);
  });

  it('outro 403 na revalidação continua encerrando a sessão', async () => {
    const { token, user } = sessionAs('u-002');
    vi.spyOn(mockApi, 'me').mockRejectedValue(new HttpError(403, 'USUARIO_INATIVO', 'Inativo'));
    vi.spyOn(mockApi, 'logout').mockResolvedValue(undefined);
    render(
      <AuthProvider initialSession={{ status: 'authenticated', token, user }}>
        <Status />
      </AuthProvider>,
    );
    expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
  });
});
