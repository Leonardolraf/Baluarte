import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import type { TipoLink } from '../models/auth.model.js';

// Acesso a dados do auth: limitadores de login e de redefinicao (tabelas
// LoginFailure e ResetRequest), links de conta (PasswordResetToken) e as escritas de
// senha e sessao no usuario.

// ---- Reserva no limitador (DT09) ----
// Contar e gravar em passos separados deixa N requisicoes simultaneas lerem a mesma contagem
// e passarem todas. A reserva conta e grava numa instrucao so, sob um advisory lock da
// transacao por (tabela, e-mail): quem chega depois espera o anterior gravar e ja o ve na
// contagem. A transacao e um lote de duas instrucoes curtas, sem codigo da aplicacao no meio
// (nunca o bcrypt nem o envio de e-mail): a conexao fica presa so o tempo das duas.
const LIMITADORES = {
  login: { tabela: Prisma.raw('"LoginFailure"'), espaco: 'baluarte.LoginFailure' },
  reset: { tabela: Prisma.raw('"ResetRequest"'), espaco: 'baluarte.ResetRequest' },
} as const;

export type Reserva = { id: string | null; anteriores: number };

/**
 * Reserva uma vaga no limite do e-mail: grava a linha so se ha menos de `maximo` na janela.
 * Devolve o id da linha gravada (null quando o limite ja estava cheio) e quantas havia antes.
 */
async function reservar(limitador: keyof typeof LIMITADORES, email: string, desde: Date, maximo: number): Promise<Reserva> {
  const { tabela, espaco } = LIMITADORES[limitador];
  const id = randomUUID();
  // Datas como texto UTC -> timestamp(3), como o Prisma grava (o default do banco dependeria
  // do fuso da sessao).
  const agora = new Date().toISOString();
  const [, linhas] = await prisma.$transaction([
    // Duas chaves de 32 bits: espaco proprio, sem cruzar com a trava de uma chave da auditoria.
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${espaco}), hashtext(lower(${email})))`,
    // Instrucao separada da trava: em READ COMMITTED ela le o que foi gravado ate a trava sair.
    prisma.$queryRaw<Array<{ anteriores: number; id: string | null }>>`
      WITH atual AS (
        SELECT count(*)::int AS anteriores FROM ${tabela}
         WHERE "email" = ${email}::citext AND "criadoEm" >= ${desde.toISOString()}::timestamp(3)
      ), nova AS (
        INSERT INTO ${tabela} ("id", "email", "criadoEm")
        SELECT ${id}, ${email}::citext, ${agora}::timestamp(3) FROM atual WHERE anteriores < ${maximo}
        RETURNING "id"
      )
      SELECT atual.anteriores, (SELECT "id" FROM nova) AS id FROM atual`,
  ]);
  return { id: linhas[0].id, anteriores: linhas[0].anteriores };
}

/** Reserva uma tentativa de login antes do bcrypt (vira a falha se a senha estiver errada). */
export function reservarTentativaLogin(email: string, desde: Date, maximo: number) {
  return reservar('login', email, desde, maximo);
}

/** Devolve a vaga de uma tentativa que nao foi falha de senha (ex.: conta inativa). */
export function cancelarTentativaLogin(id: string) {
  return prisma.loginFailure.deleteMany({ where: { id } });
}

/** Reserva um pedido de redefinicao antes de emitir o link. */
export function reservarPedidoReset(email: string, desde: Date, maximo: number) {
  return reservar('reset', email, desde, maximo);
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
