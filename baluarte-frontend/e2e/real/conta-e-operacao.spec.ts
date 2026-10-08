import { expect, test } from '@playwright/test';
import { toast } from '../helpers';
import {
  ADMIN,
  ANALYST,
  API_URL,
  SENHA_CONTA,
  aceitarConvite,
  apiCreateUser,
  apiDelete,
  apiToken,
  signIn,
  unique,
} from './apoio';

// Integração com o backend Express REAL, sem mocks: conta, sessão, vulnerabilidades,
// campanhas, usuários, preferências e RBAC. Roda pelo orquestrador (`npm run test:e2e:real`,
// scripts/e2e-real.mjs), que sobe banco descartável, API e Vite em portas próprias; ou contra
// a stack Docker: E2E_REAL=1 E2E_BASE_URL=http://localhost:8081 npx playwright test
// Tudo que os testes criam recebe nome/e-mail únicos e é removido no fim (ida e volta).

test.describe('Modo real (backend Express)', () => {
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
    // "Risco aceito" é justamente o status que o backend passou a aceitar; se a
    // primeira linha já estiver nele, o ida e volta parte de "Aberta".
    const restoreTo = original === 'accepted' ? 'open' : original;
    await select.selectOption('accepted');
    await page.getByRole('button', { name: 'Atualizar status' }).click();
    await expect(toast(page, 'Status atualizado')).toBeVisible();
    await page.reload();
    await expect(page.locator('#status')).toHaveValue('accepted');

    await page.locator('#status').selectOption(restoreTo);
    await page.getByRole('button', { name: 'Atualizar status' }).click();
    // Espera a confirmação antes do reload: recarregar aborta o PATCH em voo.
    await expect(toast(page, 'Status atualizado')).toBeVisible();
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
    const token = await apiToken(request, ANALYST.email, ANALYST.password);
    let createdId = '';
    try {
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
      createdId = page.url().split('/').pop() ?? '';
      const report = await request.get(`${API_URL}/campanhas/${encodeURIComponent(createdId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(report.ok()).toBeTruthy();
      const body = (await report.json()) as { dados: { destinatarios: number } };
      expect(body.dados.destinatarios).toBe(2);
    } finally {
      // Não deixa simulação de teste no banco de demonstração.
      if (createdId) await apiDelete(request, token, `/campanhas/${encodeURIComponent(createdId)}`);
    }
  });

  test('administrador cria, edita e exclui um usuário pelo backend', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    const email = `${unique('ui')}@empresa.com`;

    await page.goto('/users/new');
    await page.locator('#nome').fill('Conta E2E');
    await page.locator('#email').fill(email);
    await page.locator('#perfil').selectOption('collaborator');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(toast(page, 'Usuário cadastrado e convite enviado')).toBeVisible();
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
      await aceitarConvite(request, account.email);
      await signIn(page, account.email, SENHA_CONTA);
      await page.goto('/settings');
      await page.locator('#senhaAtual').fill('Errada@123');
      await page.locator('#novaSenha').fill('Nova@1234');
      await page.locator('#confirmarSenha').fill('Nova@1234');
      await page.getByRole('button', { name: 'Alterar senha' }).click();
      await expect(page.getByText('A senha atual está incorreta')).toBeVisible();

      await page.locator('#senhaAtual').fill(SENHA_CONTA);
      await page.getByRole('button', { name: 'Alterar senha' }).click();
      await expect(toast(page, 'Senha alterada com sucesso')).toBeVisible();

      await signIn(page, account.email, 'Nova@1234');
    } finally {
      await apiDelete(request, admin, `/users/${encodeURIComponent(account.id)}`);
    }
  });

  test('conta inativada pelo administrador perde o acesso', async ({ page, request }) => {
    const admin = await apiToken(request, ADMIN.email, ADMIN.password);
    const account = await apiCreateUser(request, admin, 'Colaborador');
    try {
      await aceitarConvite(request, account.email);
      await signIn(page, account.email, SENHA_CONTA);

      const patch = await request.patch(`${API_URL}/users/${encodeURIComponent(account.id)}`, {
        headers: { Authorization: `Bearer ${admin}` },
        data: { status: 'Inativo' },
      });
      expect(patch.ok()).toBeTruthy();

      // A sessão aberta cai na primeira requisição (401) e a tela volta para o login.
      await page.goto('/vulnerabilities');
      await expect(page).toHaveURL(/\/login/);

      // E o login deixa de ser aceito.
      await page.locator('#email').fill(account.email);
      await page.locator('#senha').fill(SENHA_CONTA);
      await page.locator('#btnEntrar').click();
      await expect(page.locator('#mensagem')).toContainText(/inativo/i);
    } finally {
      await apiDelete(request, admin, `/users/${encodeURIComponent(account.id)}`);
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

    // A página confere o link na API (/auth/link/verificar) antes de mostrar o formulário.
    await page.goto('/reset-password?token=nao-existe');
    await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible();
    await expect(page.locator('#mensagem')).toContainText(/inválido ou expirou/);
    await expect(page.locator('#novaSenha')).toHaveCount(0);
  });

  test('colaborador não vê as telas técnicas (RBAC do backend, não só da interface)', async ({
    page,
    request,
  }) => {
    const admin = await apiToken(request, ADMIN.email, ADMIN.password);
    const account = await apiCreateUser(request, admin, 'Colaborador');
    try {
      await aceitarConvite(request, account.email);
      await signIn(page, account.email, SENHA_CONTA);
      const token = await apiToken(request, account.email, SENHA_CONTA);
      for (const path of ['/vulnerabilidades', '/campanhas', '/usuarios', '/assets']) {
        const response = await request.get(`${API_URL}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status(), `GET ${path} para colaborador`).toBe(403);
      }
      // O dashboard é liberado, mas sem a lista técnica de achados.
      const dashboard = await request.get(`${API_URL}/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(dashboard.ok()).toBeTruthy();
      const body = (await dashboard.json()) as { dados: { vulnerabilidadesRecentes: unknown[] } };
      expect(body.dados.vulnerabilidadesRecentes).toHaveLength(0);

      await page.goto('/vulnerabilities');
      await expect(page.getByText(/Acesso negado/i)).toBeVisible();
    } finally {
      await apiDelete(request, admin, `/users/${encodeURIComponent(account.id)}`);
    }
  });
});
