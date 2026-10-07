import { prisma } from './db.js';

// Helpers de conta compartilhados pelas rotas (api.ts, manage.ts).

/** E-mail canonico: sem espacos nas pontas e em minusculas. */
export function normalizarEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

/** Verifica se um e-mail ja pertence a outro usuario (a coluna e citext: ignora maiusculas). */
export async function emailEmUso(email: string, excetoId?: string): Promise<boolean> {
  const dono = await prisma.user.findUnique({ where: { email: normalizarEmail(email) }, select: { id: true } });
  return dono !== null && dono.id !== excetoId;
}

/** Localiza um usuario pelo e-mail, ignorando maiusculas (coluna citext). */
export async function localizarPorEmail(email: string) {
  return prisma.user.findUnique({ where: { email: normalizarEmail(email) } });
}

/**
 * Departamento informado no cadastro/edicao de usuario, pelo NOME (o frontend trabalha com
 * o nome; ele e unico na tabela). `undefined` = nao mexer; `null` ou '' = sem departamento;
 * nome desconhecido ou tipo errado = 'invalido'. A coluna e citext: ignora maiusculas.
 */
export async function resolverDepartamento(valor: unknown): Promise<string | null | undefined | 'invalido'> {
  if (valor === undefined) return undefined;
  if (valor === null || (typeof valor === 'string' && valor.trim() === '')) return null;
  if (typeof valor !== 'string') return 'invalido';
  const dep = await prisma.department.findUnique({ where: { name: valor.trim() }, select: { id: true } });
  return dep?.id ?? 'invalido';
}

/** Usuario como a API devolve: departamento achatado para o nome (ou null). */
export const SELECT_USUARIO = {
  id: true, nome: true, email: true, perfil: true, status: true, criadoEm: true,
  department: { select: { name: true } },
} as const;

export function mapUsuario<T extends { department: { name: string } | null }>(u: T) {
  const { department, ...resto } = u;
  return { ...resto, departamento: department?.name ?? null };
}
