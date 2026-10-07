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

/**
 * Departamento informado no cadastro/edicao de usuario, pelo NOME (o frontend trabalha com
 * o nome; ele e unico na tabela). `undefined` = nao mexer; `null` ou '' = sem departamento;
 * nome desconhecido ou tipo errado = 'invalido'. Comparacao ignora maiusculas.
 */
export async function resolverDepartamento(valor: unknown): Promise<string | null | undefined | 'invalido'> {
  if (valor === undefined) return undefined;
  if (valor === null || (typeof valor === 'string' && valor.trim() === '')) return null;
  if (typeof valor !== 'string') return 'invalido';
  const alvo = valor.trim().toLowerCase();
  const departamentos = await prisma.department.findMany({ select: { id: true, name: true } });
  return departamentos.find((d) => d.name.toLowerCase() === alvo)?.id ?? 'invalido';
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
