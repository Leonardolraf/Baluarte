import type { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';

// Acesso a dados de usuarios e helpers de e-mail compartilhados com o modulo auth.

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

export function buscarPorId(id: string) {
  return prisma.user.findUnique({ where: { id } });
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

export async function listar() {
  return (await prisma.user.findMany({ select: SELECT_USUARIO, orderBy: { criadoEm: 'asc' } })).map(mapUsuario);
}

export function criar(dados: { nome: string; email: string; perfil: string; senhaHash: string; departmentId: string | null }) {
  return prisma.user.create({ data: { ...dados, status: 'Pendente' }, include: { department: true } });
}

/** Transacao para as regras que dependem do estado atual (check-then-act atomico). */
export function emTransacao<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/** Administradores ativos (nao Inativo) alem do usuario informado. */
export function contarOutrosAdmins(tx: Prisma.TransactionClient, excetoId: string) {
  return tx.user.count({ where: { perfil: 'Administrador', status: { not: 'Inativo' }, id: { not: excetoId } } });
}
