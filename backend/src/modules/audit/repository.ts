import { prisma } from '../../platform/db.js';

/** Grava um registro na trilha de auditoria (tabela AuditLog). */
export function criarRegistro(usuarioId: string | null, acao: string, detalhe: string | null) {
  return prisma.auditLog.create({ data: { usuarioId, acao, detalhe } });
}
