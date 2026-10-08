import { prisma } from '../../platform/db.js';

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

export async function listar() {
  const deps = await prisma.department.findMany({ include: { _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
  return deps.map((d) => ({ id: d.id, nome: d.name, usuarios: d._count.users }));
}

export function buscarComUsuarios(id: string) {
  return prisma.department.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
}

export function criar(nome: string) {
  return prisma.department.create({ data: { name: nome } });
}

export function excluir(id: string) {
  return prisma.department.delete({ where: { id } });
}

export async function nomeDoDepartamento(id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await prisma.department.findUnique({ where: { id } }))?.name ?? null;
}
