import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import type { BaseVulnerabilidade } from '../models/cruzamento.model.js';

// Cache das consultas ao OSV e ao NVD (tabela VulnerabilityCache, B14).

/** Entradas ainda validas para as chaves pedidas: Map chave -> dados. */
export async function lerValidas(base: BaseVulnerabilidade, chaves: string[], agora = new Date()): Promise<Map<string, unknown>> {
  if (!chaves.length) return new Map();
  const linhas = await prisma.vulnerabilityCache.findMany({
    where: { base, chave: { in: chaves }, expiraEm: { gt: agora } },
    select: { chave: true, dados: true },
  });
  return new Map(linhas.map((l) => [l.chave, l.dados]));
}

/** Grava (ou renova) as respostas: upsert por base + chave. */
export async function gravar(base: BaseVulnerabilidade, entradas: { chave: string; dados: unknown }[], validadeMs: number): Promise<void> {
  if (!entradas.length) return;
  const consultadoEm = new Date();
  const expiraEm = new Date(consultadoEm.getTime() + validadeMs);
  await prisma.$transaction(
    entradas.map((e) =>
      prisma.vulnerabilityCache.upsert({
        where: { base_chave: { base, chave: e.chave } },
        create: { base, chave: e.chave, dados: e.dados as Prisma.InputJsonValue, consultadoEm, expiraEm },
        update: { dados: e.dados as Prisma.InputJsonValue, consultadoEm, expiraEm },
      }),
    ),
  );
}

/** Apaga o que venceu ha mais de um dia (o que venceu ha pouco ainda pode ser renovado no lugar). */
export function limparVencidas(agora = new Date()) {
  return prisma.vulnerabilityCache.deleteMany({ where: { expiraEm: { lt: new Date(agora.getTime() - 24 * 3600_000) } } });
}
