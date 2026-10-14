import { prisma } from '../config/db.js';

// Acesso a dados do aceite dos termos de uso (Melhorias #5): so a coluna User.termosAceitosEm.

/**
 * Grava o aceite agora, so se nao ha aceite valido (nulo ou anterior a `vigencia`). A
 * condicao vai no proprio UPDATE: dois aceites simultaneos gravam uma vez so. Devolve se gravou.
 */
export async function registrarSeNovo(userId: string, vigencia: Date | null): Promise<boolean> {
  const semAceiteValido = vigencia
    ? [{ termosAceitosEm: null }, { termosAceitosEm: { lt: vigencia } }]
    : [{ termosAceitosEm: null }];
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: semAceiteValido },
    data: { termosAceitosEm: new Date() },
  });
  return count === 1;
}

/** Instante do aceite gravado (ou null); undefined se a conta nao existe mais. */
export async function buscarAceite(userId: string): Promise<Date | null | undefined> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { termosAceitosEm: true } });
  return u ? u.termosAceitosEm : undefined;
}
