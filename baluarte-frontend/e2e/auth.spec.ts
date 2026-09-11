import { expect, test } from '@playwright/test';
import { clearSession, CREDENTIALS, login } from './helpers';

test.describe('Autenticação', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('autentica com credenciais válidas e mostra o usuário no topo', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('topbar-user')).toContainText(CREDENTIALS.admin.name);
    await expect(page.getByTestId('topbar-user')).toContainText('Administrador');
  });

  test('rejeita credenciais inválidas sem sair da tela de login', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('analista@empresa.com');
    await page.locator('#senha').fill('SenhaErrada');
    await page.locator('#btnEntrar').click();
    await expect(page.locator('#mensagem')).toContainText('E-mail ou senha inválidos');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('valida e-mail obrigatório e formato antes de chamar a API', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#senha').fill('Senha@123');
    await page.locator('#btnEntrar').click();
    await expect(page.getByText('E-mail é obrigatório')).toBeVisible();
    await page.locator('#email').fill('analista-empresa.com');
    await page.locator('#btnEntrar').click();
    await expect(page.getByText('Formato de e-mail inválido')).toBeVisible();
  });

  test('anônimo é redirecionado para /login e volta ao destino original após entrar', async ({ page }) => {
    await page.goto('/vulnerabilities?q=CVE-2021-44228');
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('#email').fill(CREDENTIALS.analyst.email);
    await page.locator('#senha').fill(CREDENTIALS.analyst.password);
    await page.locator('#btnEntrar').click();
    await expect(page).toHaveURL(/\/vulnerabilities\?q=CVE-2021-44228$/);
    await expect(page.getByRole('heading', { name: 'Vulnerabilidades' })).toBeVisible();
  });

  test('sessão persiste após recarregar e "Sair" encerra a sessão', async ({ page }) => {
    await login(page, 'analyst');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
    await page.getByRole('button', { name: 'Sair' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('usuário já autenticado que abre /login vai para o dashboard', async ({ page }) => {
    await login(page, 'collaborator');
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('redefinição de senha responde com mensagem genérica (sem revelar se o e-mail existe)', async ({
    page,
  }) => {
    await page.goto('/reset-password');
    await page.locator('#email').fill('qualquer@empresa.com');
    await page.locator('#btnEnviar').click();
    await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar ao login' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continuar para a redefinição' })).toHaveCount(0);
  });

  test('redefinição de senha completa (demonstração): token, validações e login com a nova senha', async ({
    page,
  }) => {
    await page.goto('/reset-password');
    await page.locator('#email').fill('colaborador@empresa.com');
    await page.locator('#btnEnviar').click();
    await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();
    // Navegação client-side: o estado do mock (token emitido) sobrevive.
    await page.getByRole('link', { name: 'Continuar para a redefinição' }).click();
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await expect(page.getByRole('heading', { name: 'Criar nova senha' })).toBeVisible();

    await page.locator('#novaSenha').fill('Nova@1234');
    await page.locator('#confirmarSenha').fill('Outra@1234');
    await page.locator('#btnRedefinir').click();
    await expect(page.getByText('As senhas não conferem')).toBeVisible();

    await page.locator('#novaSenha').fill('semmaiuscula1!');
    await page.locator('#confirmarSenha').fill('semmaiuscula1!');
    await page.locator('#btnRedefinir').click();
    await expect(page.getByText(/maiúsculas e minúsculas/)).toBeVisible();

    await page.locator('#novaSenha').fill('Nova@1234');
    await page.locator('#confirmarSenha').fill('Nova@1234');
    await page.locator('#btnRedefinir').click();
    await expect(page.getByRole('heading', { name: 'Senha redefinida' })).toBeVisible();

    await page.getByRole('link', { name: 'Ir para o login' }).click();
    await page.locator('#email').fill('colaborador@empresa.com');
    await page.locator('#senha').fill('Nova@1234');
    await page.locator('#btnEntrar').click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('link de redefinição inválido orienta a pedir um novo', async ({ page }) => {
    await page.goto('/reset-password?token=nao-existe');
    await page.locator('#novaSenha').fill('Nova@1234');
    await page.locator('#confirmarSenha').fill('Nova@1234');
    await page.locator('#btnRedefinir').click();
    await expect(page.locator('#mensagem')).toContainText(/inválido ou expirou/);
    await page.getByRole('link', { name: 'Solicitar um novo link' }).click();
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.locator('#email')).toBeVisible();
  });
});
