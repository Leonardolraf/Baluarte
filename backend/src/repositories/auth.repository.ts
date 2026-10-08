import { prisma } from '../config/db.js';
import type { TipoLink } from '../models/auth.model.js';

// Acesso a dados do auth: limitadores de login e de redefinicao (tabelas
// LoginFailure e ResetRequest), links de conta (PasswordResetToken) e as escritas de
// senha e sessao no usuario.

export function contarFalhasLogin(email: string, desde: Date) {
  return prisma.loginFailure.count({ where: { email, criadoEm: { gte: desde } } });
}

export function criarFalhaLogin(email: string) {
  return prisma.loginFailure.create({ data: { email } });
}

/** Apaga falhas anteriores a `antes` (todas as contas) ou todas as falhas de um e-mail. */
export function apagarFalhasLogin(filtro: { antes?: Date; email?: string } = {}) {
  return prisma.loginFailure.deleteMany({
    where: {
      ...(filtro.antes ? { criadoEm: { lt: filtro.antes } } : {}),
      ...(filtro.email ? { email: filtro.email } : {}),
    },
  });
}

export function contarPedidosReset(email: string, desde: Date) {
  return prisma.resetRequest.count({ where: { email, criadoEm: { gte: desde } } });
}

export function criarPedidoReset(email: string) {
  return prisma.resetRequest.create({ data: { email } });
}

export function apagarPedidosReset(antes?: Date) {
  return prisma.resetRequest.deleteMany({ where: antes ? { criadoEm: { lt: antes } } : {} });
}

/** Troca a senha de quem esta logado: grava o hash, encerra as outras sessoes e invalida links. */
export function trocarSenha(userId: string, senhaHash: string) {
  return prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { senhaHash, senhaAlteradaEm: new Date() } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
  ]);
}

/** Conclui a redefinicao (ou o convite) pelo link de uso unico. */
export function concluirRedefinicao(
  registro: { id: string; userId: string; user: { status: string; email: string } },
  senhaHash: string,
) {
  return prisma.$transaction([
    prisma.user.update({
      where: { id: registro.userId },
      data: {
        senhaHash,
        status: registro.user.status === 'Pendente' ? 'Ativo' : registro.user.status,
        // Sessoes abertas antes da redefinicao deixam de valer (ver exigeToken).
        senhaAlteradaEm: new Date(),
      },
    }),
    prisma.passwordResetToken.update({ where: { id: registro.id }, data: { usadoEm: new Date() } }),
    // Demais tokens pendentes do mesmo usuario perdem a validade.
    prisma.passwordResetToken.deleteMany({ where: { userId: registro.userId, id: { not: registro.id } } }),
    // Quem provou ser dono do e-mail sai do bloqueio por tentativas.
    prisma.loginFailure.deleteMany({ where: { email: registro.user.email } }),
  ]);
}

export function encerrarSessoes(userId: string) {
  return prisma.user.update({ where: { id: userId }, data: { sessaoEncerradaEm: new Date() } });
}

/** Grava o link de conta (so o hash do token). Um convite novo apaga os convites pendentes. */
export function gravarLinkConta(dados: { userId: string; tipo: TipoLink; tokenHash: string; expiraEm: Date }) {
  return prisma.$transaction([
    ...(dados.tipo === 'CONVITE'
      ? [prisma.passwordResetToken.deleteMany({ where: { userId: dados.userId, tipo: 'CONVITE', usadoEm: null } })]
      : []),
    prisma.passwordResetToken.create({ data: dados }),
  ]);
}

/** Link de conta pelo hash do token, com o dono. */
export function buscarLinkPorHash(tokenHash: string) {
  return prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
}
