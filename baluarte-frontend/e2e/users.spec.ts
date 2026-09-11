import { expect, test } from '@playwright/test';
import { clearSession, login, toast } from './helpers';

test.describe('Gestão de usuários (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await login(page, 'admin');
  });

  test('cria um usuário, encontra na tabela e o exclui com confirmação', async ({ page }) => {
    await page.goto('/users/new');
    await page.locator('#nome').fill('Teste E2E');
    await page.locator('#email').fill('teste.e2e@empresa.com');
    await page.locator('#perfil').selectOption('analyst');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(toast(page, 'Usuário cadastrado com sucesso')).toBeVisible();
    await expect(page).toHaveURL(/\/users$/);

    await page.getByPlaceholder(/Buscar por nome/).fill('teste.e2e');
    const row = page.getByRole('row').filter({ hasText: 'teste.e2e@empresa.com' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Analista');

    await row.getByRole('button', { name: /Excluir Teste E2E/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Teste E2E');
    await dialog.getByRole('button', { name: 'Excluir' }).click();
    await expect(toast(page, 'Usuário excluído')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'teste.e2e@empresa.com' })).toHaveCount(0);
  });

  test('rejeita e-mail duplicado e não permite excluir a própria conta', async ({ page }) => {
    await page.goto('/users/new');
    await page.locator('#nome').fill('Duplicado');
    await page.locator('#email').fill('admin@empresa.com');
    await page.locator('#perfil').selectOption('collaborator');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Email já cadastrado')).toBeVisible();

    await page.goto('/users');
    const ownRow = page.getByRole('row').filter({ hasText: 'admin@empresa.com' });
    await expect(ownRow.getByRole('button', { name: /Excluir/ })).toBeDisabled();
  });

  test('edita o perfil de um usuário existente', async ({ page }) => {
    await page.goto('/users');
    const row = page.getByRole('row').filter({ hasText: 'bruno.lima@empresa.com' });
    await row.getByRole('link', { name: /Editar Bruno Lima/ }).click();
    await expect(page).toHaveURL(/\/users\/[^/]+\/edit$/);
    await expect(page.locator('#nome')).toHaveValue('Bruno Lima');
    await page.locator('#perfil').selectOption('analyst');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(toast(page, 'Usuário atualizado')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'bruno.lima@empresa.com' })).toContainText(
      'Analista',
    );
  });
});
