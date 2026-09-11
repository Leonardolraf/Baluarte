import { prisma } from './db.js';

// Trilha de auditoria (tabela AuditLog): registra as acoes sensiveis das rotas de
// escrita. Nunca derruba a requisicao — uma falha aqui vira apenas log de erro.
export async function registrarAuditoria(
  usuarioId: string | null,
  acao: string,
  detalhe?: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { usuarioId, acao, detalhe: detalhe ?? null } });
  } catch (e) {
    console.error('[auditoria] falha ao registrar', acao, e);
  }
}
