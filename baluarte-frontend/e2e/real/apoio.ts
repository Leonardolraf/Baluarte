import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Apoio da suíte em modo real (e2e/real/): endereços, contas do seed e chamadas diretas à API.
// O orquestrador (scripts/e2e-real.mjs na raiz) define as variáveis abaixo; sem ele, os
// padrões apontam para a stack Docker (API :8080, Mailpit :8025).

/** API real. O orquestrador usa uma porta própria (8097), nunca a 8080. */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
/** Mailpit: é por onde o convite de conta chega fora dos testes do backend. */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

// Contas do seed do backend (backend/prisma/seed.ts).
export const ADMIN = { email: 'admin@empresa.com', password: 'Admin@123' };
export const ANALYST = { email: 'analista@empresa.com', password: 'Senha@123' };
export const COLLABORATOR = { email: 'colaborador@empresa.com', password: 'Colab@123' };

/** Senha que a conta nova ganha ao aceitar o convite (não existe senha provisória). */
export const SENHA_CONTA = 'Conta@1234';

export function unique(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 10_000)}`;
}

/** Login pela tela, partindo de uma sessão vazia, até o dashboard. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.locator('#email').fill(email);
  await page.locator('#senha').fill(password);
  await page.locator('#btnEntrar').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Visão geral de risco' })).toBeVisible();
}

export async function apiToken(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${API_URL}/login`, { data: { email, senha: password } });
  expect(response.ok(), `login de ${email} na API`).toBeTruthy();
  const body = (await response.json()) as { dados: { token: string } };
  return body.dados.token;
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function apiCreateUser(
  request: APIRequestContext,
  token: string,
  perfil: 'Administrador' | 'Analista' | 'Colaborador',
): Promise<{ id: string; email: string }> {
  const email = `${unique('e2e')}@empresa.com`;
  const response = await request.post(`${API_URL}/users`, {
    headers: bearer(token),
    data: { nome: 'Conta E2E', email, perfil },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { dados: { idUsuario: string } };
  return { id: body.dados.idUsuario, email };
}

/**
 * Aceita o convite da conta recém-criada: lê o e-mail no Mailpit, extrai o token do link
 * e define a senha. Sem isso a conta fica `Pendente` e o login é recusado (CONTA_PENDENTE).
 * O envio é assíncrono em relação ao Mailpit indexar a mensagem: espera ela aparecer.
 */
export async function aceitarConvite(request: APIRequestContext, email: string): Promise<void> {
  const buscar = async (): Promise<string | undefined> => {
    const busca = await request.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    expect(busca.ok(), `Mailpit respondeu a busca do convite de ${email}`).toBeTruthy();
    const { messages } = (await busca.json()) as { messages: Array<{ ID: string }> };
    return messages[0]?.ID;
  };
  await expect.poll(buscar, { message: `convite de ${email} no Mailpit` }).toBeTruthy();
  const id = (await buscar())!;

  const mensagem = await request.get(`${MAILPIT_URL}/api/v1/message/${id}`);
  expect(mensagem.ok()).toBeTruthy();
  const { Text } = (await mensagem.json()) as { Text: string };
  const token = /definir-senha\?token=([\w-]+)/.exec(Text)?.[1];
  expect(token, `token no corpo do convite de ${email}`).toBeTruthy();

  const confirma = await request.post(`${API_URL}/auth/reset-password/confirm`, {
    data: { token, novaSenha: SENHA_CONTA },
  });
  expect(confirma.ok(), `aceite do convite de ${email}`).toBeTruthy();
}

export async function apiDelete(request: APIRequestContext, token: string, path: string): Promise<void> {
  await request.delete(`${API_URL}${path}`, { headers: bearer(token) });
}
