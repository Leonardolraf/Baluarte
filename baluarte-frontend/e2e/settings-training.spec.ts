import { expect, test } from '@playwright/test';
import { clearSession, login, toast } from './helpers';

test.describe('Configurações e treinamento', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('troca de senha valida a senha atual e a política', async ({ page }) => {
    await login(page, 'collaborator');
    await page.goto('/settings');
    await page.locator('#senhaAtual').fill('errada');
    await page.locator('#novaSenha').fill('Nova@1234');
    await page.locator('#confirmarSenha').fill('Nova@1234');
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page.getByText('A senha atual está incorreta.')).toBeVisible();

    await page.locator('#senhaAtual').fill('Colab@123');
    await page.locator('#novaSenha').fill('fraca');
    await page.locator('#confirmarSenha').fill('fraca');
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page.getByText(/pelo menos 8 caracteres/i).first()).toBeVisible();

    await page.locator('#novaSenha').fill('Nova@1234');
    await page.locator('#confirmarSenha').fill('Nova@1234');
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(toast(page, 'Senha alterada com sucesso')).toBeVisible();
  });

  test('salva preferências de notificação e alterna o tema', async ({ page }) => {
    await login(page, 'analyst');
    await page.goto('/settings');
    const weekly = page.getByRole('switch', { name: /Resumo semanal/ });
    await expect(weekly).toBeVisible();
    const before = await weekly.getAttribute('aria-checked');
    await weekly.click();
    await expect(weekly).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await page.getByRole('button', { name: 'Salvar preferências' }).click();
    await expect(toast(page, 'Preferências salvas')).toBeVisible();

    const html = page.locator('html');
    const darkBefore = await html.evaluate((el) => el.classList.contains('dark'));
    await page.getByRole('switch', { name: /Tema escuro/ }).click();
    await expect.poll(async () => html.evaluate((el) => el.classList.contains('dark'))).toBe(!darkBefore);
  });

  test('colaborador conclui o treinamento a partir do dashboard', async ({ page }) => {
    await login(page, 'collaborator');
    await page.getByRole('link', { name: 'Iniciar treinamento' }).click();
    await expect(page).toHaveURL(/\/training\/trn-/);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    await page.getByRole('button', { name: 'Marcar como concluído' }).click();
    await expect(toast(page, 'Treinamento concluído!')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByRole('button', { name: 'Concluído' })).toBeDisabled();
  });

  test('página Sobre é pública e mostra os módulos', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'Baluarte' }).first()).toBeVisible();
    await expect(page.getByText('Varredura de vulnerabilidades').first()).toBeVisible();
    await expect(page.getByText('Phishing simulado').first()).toBeVisible();
  });
});
