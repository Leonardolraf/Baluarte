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

/** Entradas por instrucao na gravacao do cache (cada uma leva a resposta inteira da base em JSON). */
const LOTE_CACHE = 200;

/**
 * Grava (ou renova) as respostas: upsert por base + chave, numa instrucao por lote (DT17). Um
 * upsert por entrada eram centenas de idas e voltas ao banco remoto numa verificacao (705
 * programas na estacao Ubuntu), segurando a conexao por minutos. Cache nao precisa ser atomico:
 * lote que falha so faz a proxima verificacao consultar de novo. Chave repetida fica a ultima.
 */
export async function gravar(base: BaseVulnerabilidade, entradas: { chave: string; dados: unknown }[], validadeMs: number): Promise<void> {
  const unicas = [...new Map(entradas.map((e) => [e.chave, e])).values()];
  if (!unicas.length) return;
  const consultadoEm = new Date();
  const expiraEm = new Date(consultadoEm.getTime() + validadeMs);
  for (let i = 0; i < unicas.length; i += LOTE_CACHE) {
    const lote = JSON.stringify(unicas.slice(i, i + LOTE_CACHE).map((e) => ({ chave: e.chave, dados: e.dados })));
    await prisma.$executeRaw`
      INSERT INTO "VulnerabilityCache" ("id", "base", "chave", "dados", "consultadoEm", "expiraEm")
      SELECT gen_random_uuid()::text, ${base}, x.chave, x.dados,
             (${consultadoEm.toISOString()}::timestamptz AT TIME ZONE 'UTC'), (${expiraEm.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${lote}::jsonb) AS x(chave text, dados jsonb)
      ON CONFLICT ("base", "chave") DO UPDATE
        SET "dados" = EXCLUDED."dados", "consultadoEm" = EXCLUDED."consultadoEm", "expiraEm" = EXCLUDED."expiraEm"`;
  }
}

/** Apaga o que venceu ha mais de um dia (o que venceu ha pouco ainda pode ser renovado no lugar). */
export function limparVencidas(agora = new Date()) {
  return prisma.vulnerabilityCache.deleteMany({ where: { expiraEm: { lt: new Date(agora.getTime() - 24 * 3600_000) } } });
}
