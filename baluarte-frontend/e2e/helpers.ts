import { expect, type Page } from '@playwright/test';

export type DemoRole = 'admin' | 'analyst' | 'collaborator';

export const CREDENTIALS: Record<DemoRole, { email: string; password: string; name: string }> = {
  admin: { email: 'admin@empresa.com', password: 'Admin@123', name: 'Leonardo Rodrigues' },
  analyst: { email: 'analista@empresa.com', password: 'Senha@123', name: 'Rafael Nunes' },
  collaborator: { email: 'colaborador@empresa.com', password: 'Colab@123', name: 'João Pereira' },
};

/** Faz login pela tela (ids estáveis: email / senha / btnEntrar) e espera o dashboard. */
export async function login(page: Page, role: DemoRole): Promise<void> {
  const { email, password } = CREDENTIALS[role];
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#senha').fill(password);
  await page.locator('#btnEntrar').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
}

/**
 * Limpa a sessão guardada no navegador (token + usuário) e desliga a injeção
 * aleatória de falhas do mock (4 % em dev), que tornaria o E2E não determinístico.
 */
export async function clearSession(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('baluarte.mock', JSON.stringify({ failureRate: 0, latencyMs: [20, 60] }));
  });
  await page.reload();
}

/** Toast do react-hot-toast contendo o texto. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole('status').filter({ hasText: text }).first();
}
