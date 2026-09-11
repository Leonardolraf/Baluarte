import { expect, test } from '@playwright/test';
import { clearSession, login } from './helpers';

test.describe('Layout responsivo (mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await login(page, 'admin');
  });

  test('sidebar vira gaveta: abre pelo menu, prende o foco e fecha com Escape', async ({ page }) => {
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu de navegação' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Vulnerabilidades' })).toBeVisible();
    const focusedInside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return !!dialog && dialog.contains(document.activeElement);
    });
    expect(focusedInside).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('não há rolagem horizontal no dashboard nem na lista de vulnerabilidades', async ({ page }) => {
    for (const path of ['/dashboard', '/vulnerabilities', '/campaigns/camp-001']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow horizontal em ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test('navega pela gaveta até as campanhas', async ({ page }) => {
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Campanhas' }).click();
    await expect(page).toHaveURL(/\/campaigns$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Campanhas de phishing' })).toBeVisible();
  });
});
