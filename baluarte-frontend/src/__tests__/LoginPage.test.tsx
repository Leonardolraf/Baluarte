import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, type MemoryRouterProps } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@/types';
import { AuthProvider, type AuthProviderProps } from '@/contexts/AuthContext';
import { buildMockToken, decodeToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_CREDENTIALS, MOCK_USERS } from '@/mocks/data';
import LoginPage from '@/pages/Auth/LoginPage';

type Session = NonNullable<AuthProviderProps['initialSession']>;
type Entry = NonNullable<MemoryRouterProps['initialEntries']>[number];

const ANONYMOUS: Session = { status: 'anonymous', token: null, user: null };

const ADMIN = MOCK_CREDENTIALS.find((credential) => credential.email === 'admin@empresa.com');
if (!ADMIN) throw new Error('Credencial de administrador ausente em MOCK_CREDENTIALS');

/** Stub que expõe a query string e o hash com que a rota foi aberta. */
function CampaignsStub() {
  const { search, hash } = useLocation();
  return (
    <>
      <h1>Campanhas (stub)</h1>
      <p data-testid="location">{`${search}${hash}`}</p>
    </>
  );
}

function renderLogin(session: Session = ANONYMOUS, entry: Entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider initialSession={session} revalidateOnMount={false}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<h1>Dashboard (stub)</h1>} />
          <Route path="/campaigns" element={<CampaignsStub />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fields() {
  return {
    email: screen.getByLabelText(/^E-mail/),
    password: screen.getByLabelText(/^Senha/),
    submit: screen.getByRole('button', { name: 'Entrar' }),
  };
}

describe('LoginPage', () => {
  it('renderiza o formulário acessível com os ids do contrato', () => {
    renderLogin();

    expect(screen.getByRole('heading', { name: 'Entrar no Baluarte' })).toBeInTheDocument();
    const { email, password, submit } = fields();
    expect(email).toHaveAttribute('id', 'email');
    expect(email).toHaveAttribute('type', 'email');
    expect(password).toHaveAttribute('id', 'senha');
    expect(password).toHaveAttribute('type', 'password');
    expect(submit).toHaveAttribute('id', 'btnEntrar');
    expect(screen.getByRole('link', { name: 'Esqueci minha senha' })).toHaveAttribute(
      'href',
      '/reset-password',
    );
    // O banner `#mensagem` (role="alert") só entra no DOM quando há erro da API.
    expect(document.getElementById('mensagem')).toBeNull();
  });

  it('autentica com credenciais válidas do mock e navega para /dashboard', async () => {
    const user = userEvent.setup();
    renderLogin();

    const { email, password, submit } = fields();
    await user.type(email, ADMIN.email);
    await user.type(password, ADMIN.password);
    await user.click(submit);

    expect(await screen.findByRole('heading', { name: 'Dashboard (stub)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Entrar no Baluarte' })).not.toBeInTheDocument();

    const token = tokenStorage.get();
    expect(token).not.toBeNull();
    expect(decodeToken(token)?.sub).toBe(ADMIN.userId);
    expect(userStorage.get()).toMatchObject({ id: ADMIN.userId, email: ADMIN.email, role: 'admin' });
  });

  it('após o login, volta para a origem guardada em state.from (com query string e hash)', async () => {
    const user = userEvent.setup();
    renderLogin(ANONYMOUS, {
      pathname: '/login',
      state: { from: { pathname: '/campaigns', search: '?status=active', hash: '#relatorio' } },
    });

    const { email, password, submit } = fields();
    await user.type(email, ADMIN.email);
    await user.type(password, ADMIN.password);
    await user.click(submit);

    expect(await screen.findByRole('heading', { name: 'Campanhas (stub)' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?status=active#relatorio');
  });

  it('mostra a mensagem de erro da API para credenciais inválidas e não navega', async () => {
    const user = userEvent.setup();
    renderLogin();

    const { email, password, submit } = fields();
    await user.type(email, ADMIN.email);
    await user.type(password, 'senha-errada');
    await user.click(submit);

    const banner = await screen.findByTestId('form-error');
    expect(banner).toHaveAttribute('id', 'mensagem');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('E-mail ou senha inválidos');
    expect(screen.getByRole('heading', { name: 'Entrar no Baluarte' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard (stub)' })).not.toBeInTheDocument();
    expect(tokenStorage.get()).toBeNull();
    expect(userStorage.get()).toBeNull();
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('valida campos obrigatórios e formato de e-mail antes de chamar a API', async () => {
    const user = userEvent.setup();
    renderLogin();

    const { email, submit } = fields();
    await user.click(submit);

    expect(await screen.findByText('E-mail é obrigatório')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Senha é obrigatória')).toHaveAttribute('role', 'alert');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'email-error');

    await user.type(email, 'sem-arroba');
    await user.click(submit);

    expect(await screen.findByText('Formato de e-mail inválido')).toBeInTheDocument();
    expect(tokenStorage.get()).toBeNull();
  });

  it('o botão "Usar" do ambiente de demonstração preenche as credenciais', async () => {
    const user = userEvent.setup();
    renderLogin();

    // As credenciais vêm de `@/mocks/data` por `import()` dinâmico: o bloco aparece de forma assíncrona.
    expect(await screen.findByText('Ambiente de demonstração')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Usar Administrador (${ADMIN.email})` }));

    const { email, password } = fields();
    expect(email).toHaveValue(ADMIN.email);
    expect(password).toHaveValue(ADMIN.password);
  });

  it('alterna a visibilidade da senha com o botão de olho', async () => {
    const user = userEvent.setup();
    renderLogin();

    const { password } = fields();
    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);

    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('redireciona usuário já autenticado para /dashboard', () => {
    const found = MOCK_USERS.find((candidate) => candidate.id === ADMIN.userId);
    if (!found) throw new Error('Usuário administrador ausente em MOCK_USERS');
    const authUser: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
    const token = buildMockToken({
      sub: authUser.id,
      email: authUser.email,
      name: authUser.name,
      role: authUser.role,
    });
    tokenStorage.set(token);
    userStorage.set(authUser);

    renderLogin({ status: 'authenticated', token, user: authUser });

    expect(screen.getByRole('heading', { name: 'Dashboard (stub)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Entrar no Baluarte' })).not.toBeInTheDocument();
  });
});
