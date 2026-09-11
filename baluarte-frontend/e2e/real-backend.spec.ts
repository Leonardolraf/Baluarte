import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { toast } from './helpers';

// Integração com o backend Express REAL (../backend em :8080), sem mocks.
// Só roda com E2E_REAL=1 e o frontend servido com VITE_USE_MOCKS=false, por exemplo:
//   VITE_USE_MOCKS=false npx vite --port 5174   (em outro terminal, com o backend no ar)
//   E2E_REAL=1 E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/real-backend.spec.ts
// Credenciais do seed do backend: analista@empresa.com / Senha@123 e admin@empresa.com / Admin@123.
// Tudo que os testes criam recebe nome/e-mail únicos e é desfeito ao final (ida e volta).

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const ADMIN = { email: 'admin@empresa.com', password: 'Admin@123' };
const ANALYST = { email: 'analista@empresa.com', password: 'Senha@123' };
/** Senha provisória que `POST /users` atribui a contas novas. */
const PROVISIONAL_PASSWORD = 'Mudar@123';

function unique(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 10_000)}`;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.locator('#email').fill(email);
  await page.locator('#senha').fill(password);
  await page.locator('#btnEntrar').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
}

async function apiToken(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${API_URL}/login`, { data: { email, senha: password } });
  expect(response.ok(), `login de ${email} na API`).toBeTruthy();
  const body = (await response.json()) as { dados: { token: string } };
  return body.dados.token;
}

async function apiCreateUser(
  request: APIRequestContext,
  token: string,
  perfil: 'Administrador' | 'Analista' | 'Colaborador',
): Promise<{ id: string; email: string }> {
  const email = `${unique('e2e')}@empresa.com`;
  const response = await request.post(`${API_URL}/users`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { nome: 'Conta E2E', email, perfil },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { dados: { idUsuario: string } };
  return { id: body.dados.idUsuario, email };
}

async function apiDeleteUser(request: APIRequestContext, token: string, id: string): Promise<void> {
  await request.delete(`${API_URL}/users/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe('Modo real (backend Express)', () => {
  test.skip(process.env.E2E_REAL !== '1', 'defina E2E_REAL=1 com o backend e o frontend em modo real no ar');

  test('login sem bloco de demonstração e dashboard alimentado pela API', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Ambiente de demonstração')).toHaveCount(0);
    await signIn(page, ANALYST.email, ANALYST.password);
    await expect(page.getByRole('meter', { name: 'Risco técnico' })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Risco humano' })).toBeVisible();
    await expect(page.getByTestId('topbar-user')).toContainText('Analista');
  });

  test('sessão sobrevive a um recarregamento (JWT HS256 do backend é decodificado)', async ({ page }) => {
    await signIn(page, ANALYST.email, ANALYST.password);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
    await expect(page.getByTestId('topbar-user')).toContainText('Analista');
  });

  test('vulnerabilidades: lista, detalhe e status "Risco aceito" (ida e volta)', async ({ page }) => {
    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto('/vulnerabilities');
    const rows = page.getByTestId('vuln-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    await rows.first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/vulnerabilities\/[^/]+$/);
    await expect(page.getByRole('tab', { name: /Evidências/ })).toBeVisible();

    const select = page.locator('#status');
    const original = await select.inputValue();
    const restoreTo = original === 'accepted' ? 'open' : original;
    await select.selectOption('accepted');
    await page.getByRole('button', { name: 'Atualizar status' }).click();
    await expect(toast(page, 'Status atualizado')).toBeVisible();
    await page.reload();
    await expect(page.locator('#status')).toHaveValue('accepted');

    await page.locator('#status').selectOption(restoreTo);
    await page.getByRole('button', { name: 'Atualizar status' }).click();
    await page.reload();
    await expect(page.locator('#status')).toHaveValue(restoreTo);
  });

  test('campanhas: relatório do backend e criação com dois destinatários', async ({ page, request }) => {
    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto('/campaigns');
    const rows = page.getByTestId('campaign-row');
    await expect(rows.first()).toBeVisible();
    await rows.first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
    await expect(page.getByText('Funil da campanha')).toBeVisible();

    const name = `Campanha E2E ${unique('real')}`;
    await page.goto('/campaigns/new');
    await page.locator('#nome').fill(name);
    await page.getByRole('radio', { name: /Curiosidade/ }).check();
    await page.locator('#grupo').selectOption({ label: 'TI' });
    await page.locator('#destinatarios').fill('ana.souza@empresa.com\nbruno.lima@empresa.com');
    await expect(page.getByText('2 destinatários válidos')).toBeVisible();
    await page.getByRole('button', { name: 'Agendar campanha' }).click();
    await expect(toast(page, 'Campanha agendada com sucesso')).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // O backend registrou os dois destinatários (um evento por e-mail).
    const id = page.url().split('/').pop() ?? '';
    const token = await apiToken(request, ANALYST.email, ANALYST.password);
    const report = await request.get(`${API_URL}/campanhas/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(report.ok()).toBeTruthy();
    const body = (await report.json()) as { dados: { destinatarios: number } };
    expect(body.dados.destinatarios).toBe(2);
  });

  test('administrador cria, edita e exclui um usuário pelo backend', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    const email = `${unique('ui')}@empresa.com`;

    await page.goto('/users/new');
    await page.locator('#nome').fill('Conta E2E');
    await page.locator('#email').fill(email);
    await page.locator('#perfil').selectOption('collaborator');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(toast(page, 'Usuário cadastrado com sucesso')).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);

    const row = page.getByRole('row').filter({ hasText: email });
    await page.getByPlaceholder(/Buscar por nome/).fill(email);
    await expect(row).toHaveCount(1);
    await row.getByRole('link', { name: /Editar Conta E2E/ }).click();
    await expect(page).toHaveURL(/\/users\/[^/]+\/edit$/);
    await expect(page.locator('#nome')).toHaveValue('Conta E2E');
    await page.locator('#perfil').selectOption('analyst');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(toast(page, 'Usuário atualizado')).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);

    await page.getByPlaceholder(/Buscar por nome/).fill(email);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Analista');
    await row.getByRole('button', { name: /Excluir Conta E2E/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Excluir' }).click();
    await expect(toast(page, 'Usuário excluído')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0);
  });

  test('usuário troca a própria senha e entra com a nova', async ({ page, request }) => {
    const admin = await apiToken(request, ADMIN.email, ADMIN.password);
    const account = await apiCreateUser(request, admin, 'Colaborador');
    try {
      await signIn(page, account.email, PROVISIONAL_PASSWORD);
      await page.goto('/settings');
      await page.locator('#senhaAtual').fill('Errada@123');
      await page.locator('#novaSenha').fill('Nova@1234');
      await page.locator('#confirmarSenha').fill('Nova@1234');
      await page.getByRole('button', { name: 'Alterar senha' }).click();
      await expect(page.getByText('A senha atual está incorreta')).toBeVisible();

      await page.locator('#senhaAtual').fill(PROVISIONAL_PASSWORD);
      await page.getByRole('button', { name: 'Alterar senha' }).click();
      await expect(toast(page, 'Senha alterada com sucesso')).toBeVisible();

      await signIn(page, account.email, 'Nova@1234');
    } finally {
      await apiDeleteUser(request, admin, account.id);
    }
  });

  test('preferências de notificação persistem no backend (ida e volta)', async ({ page }) => {
    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto('/settings');
    const weekly = page.getByRole('switch', { name: /Resumo semanal/ });
    await expect(weekly).toBeVisible();
    const before = await weekly.getAttribute('aria-checked');
    const after = before === 'true' ? 'false' : 'true';
    await weekly.click();
    await page.getByRole('button', { name: 'Salvar preferências' }).click();
    await expect(toast(page, 'Preferências salvas')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('switch', { name: /Resumo semanal/ })).toHaveAttribute('aria-checked', after);

    await page.getByRole('switch', { name: /Resumo semanal/ }).click();
    await page.getByRole('button', { name: 'Salvar preferências' }).click();
    await expect(toast(page, 'Preferências salvas')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('switch', { name: /Resumo semanal/ })).toHaveAttribute(
      'aria-checked',
      before ?? 'true',
    );
  });

  test('redefinição de senha: mensagem genérica sem token exposto; link inválido é rejeitado pela API', async ({
    page,
  }) => {
    await page.goto('/reset-password');
    await page.locator('#email').fill(`${unique('reset')}@empresa.com`);
    await page.locator('#btnEnviar').click();
    await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continuar para a redefinição' })).toHaveCount(0);

    await page.goto('/reset-password?token=nao-existe');
    await page.locator('#novaSenha').fill('Nova@1234');
    await page.locator('#confirmarSenha').fill('Nova@1234');
    await page.locator('#btnRedefinir').click();
    await expect(page.locator('#mensagem')).toContainText(/inválido ou expirou/);
  });
});
