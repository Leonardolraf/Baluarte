import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import type { AlteracaoUsuario } from '../models/usuario.model.js';
import { normalizarEmail } from '../utils/validacao.js';

// Acesso a dados de usuarios e helpers de e-mail compartilhados com o auth. As funcoes que
// recebem `db` rodam no cliente padrao ou dentro de uma transacao (`emTransacao`).

type Db = Prisma.TransactionClient;


/** Verifica se um e-mail ja pertence a outro usuario (a coluna e citext: ignora maiusculas). */
export async function emailEmUso(email: string, excetoId?: string): Promise<boolean> {
  const dono = await prisma.user.findUnique({ where: { email: normalizarEmail(email) }, select: { id: true } });
  return dono !== null && dono.id !== excetoId;
}

/** Localiza um usuario pelo e-mail, ignorando maiusculas (coluna citext). */
export async function localizarPorEmail(email: string) {
  return prisma.user.findUnique({ where: { email: normalizarEmail(email) } });
}

export function buscarPorId(id: string, db: Db = prisma) {
  return db.user.findUnique({ where: { id } });
}

/** Id do dono de um e-mail ja normalizado (ou null). */
export function donoDoEmail(email: string, db: Db = prisma) {
  return db.user.findUnique({ where: { email }, select: { id: true } });
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

export function atualizar(id: string, dados: AlteracaoUsuario, db: Db = prisma) {
  return db.user.update({ where: { id }, data: dados, select: SELECT_USUARIO });
}

export function excluir(id: string, db: Db = prisma) {
  return db.user.delete({ where: { id } });
}

/** Quantos eventos de campanha o usuario tem (historico que impede a exclusao). */
export function contarEventosCampanha(userId: string, db: Db = prisma) {
  return db.campaignEvent.count({ where: { userId } });
}

/** Transacao para as regras que dependem do estado atual (check-then-act atomico). */
export function emTransacao<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/** Administradores ativos (nao Inativo) alem do usuario informado. */
export function contarOutrosAdmins(tx: Db, excetoId: string) {
  return tx.user.count({ where: { perfil: 'Administrador', status: { not: 'Inativo' }, id: { not: excetoId } } });
}
