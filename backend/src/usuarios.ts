import { prisma } from './db.js';

// Helpers de conta compartilhados pelas rotas (api.ts, manage.ts).

/** E-mail canonico: sem espacos nas pontas e em minusculas. */
export function normalizarEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Verifica se um e-mail ja pertence a outro usuario, ignorando maiusculas
 * (o @unique do SQLite e sensivel a caixa e bancos antigos podem ter e-mails mistos).
 */
export async function emailEmUso(email: string, excetoId?: string): Promise<boolean> {
  const alvo = normalizarEmail(email);
  const usuarios = await prisma.user.findMany({ select: { id: true, email: true } });
  return usuarios.some((u) => u.email.toLowerCase() === alvo && u.id !== excetoId);
}

/** Localiza um usuario pelo e-mail ignorando maiusculas. */
export async function localizarPorEmail(email: string) {
  const alvo = normalizarEmail(email);
  const exato = await prisma.user.findUnique({ where: { email: alvo } });
  if (exato) return exato;
  const usuarios = await prisma.user.findMany();
  return usuarios.find((u) => u.email.toLowerCase() === alvo) ?? null;
}
