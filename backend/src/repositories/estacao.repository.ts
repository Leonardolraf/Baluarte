import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import type { EstacaoComContagem, EstacaoComInventario } from '../models/estacao.model.js';
import { registrarCriacaoDosAchados } from './vulnerabilidade.repository.js';

// Acesso ao banco das estacoes: leitura do painel (B13) das tabelas que o agente osquery
// preenche (Workstation, WorkstationSoftware, WorkstationPort) e as escritas do cruzamento
// com as bases de vulnerabilidades (B14: achados da estacao e verificadaEm).

/** Todas as estacoes, com o ativo e a quantidade de programas e portas, por nome. */
export function listar(): Promise<EstacaoComContagem[]> {
  return prisma.workstation.findMany({
    include: { asset: true, _count: { select: { programas: true, portas: true } } },
    orderBy: [{ asset: { nome: 'asc' } }, { id: 'asc' }],
  });
}

/** Uma estacao com o inventario mais recente (programas por nome, portas por numero). */
export function buscarComInventario(id: string): Promise<EstacaoComInventario | null> {
  return prisma.workstation.findUnique({
    where: { id },
    include: {
      asset: true,
      programas: { orderBy: [{ nome: 'asc' }, { versao: 'asc' }, { fonte: 'asc' }] },
      portas: { orderBy: [{ porta: 'asc' }, { protocolo: 'asc' }, { endereco: 'asc' }] },
    },
  });
}

/** Achados da estacao (B14): total e os ainda em aberto (fora "Resolvida" e "Risco aceito"). */
export async function contarAchados(workstationId: string): Promise<{ total: number; abertos: number }> {
  const [total, abertos] = await Promise.all([
    prisma.finding.count({ where: { workstationId } }),
    prisma.finding.count({ where: { workstationId, status: { notIn: STATUS_FINDING_ENCERRADO } } }),
  ]);
  return { total, abertos };
}

// ---- Cruzamento com as bases de vulnerabilidades (B14) ------------------------------

/** Estacao (pelo id dela ou do ativo dela) com o ativo e o inventario de programas. */
export function buscarParaVerificacao(id: string) {
  return prisma.workstation.findFirst({
    where: { OR: [{ id }, { assetId: id }] },
    include: { asset: true, programas: { orderBy: [{ fonte: 'asc' }, { nome: 'asc' }] } },
  });
}

/** Pares CVE + programa que ja viraram achado nesta estacao (em qualquer verificacao). */
export async function achadosExistentes(workstationId: string): Promise<Set<string>> {
  const linhas = await prisma.finding.findMany({ where: { workstationId }, select: { cve: true, programa: true } });
  return new Set(linhas.map((l) => `${l.cve}\u0001${l.programa}`));
}

class NadaNovo extends Error {}

/**
 * Limites da transacao dos achados da estacao (DT17). O padrao do Prisma (5 s) estourava com o
 * banco remoto: a VM no Brasil e o Supabase nos EUA, centenas de achados com remediacao em JSON e
 * o evento de historico de cada um. Estourado, o Prisma desfaz tudo e a verificacao nao conclui.
 */
const TRANSACAO_ACHADOS = { maxWait: 10_000, timeout: 60_000 };

/**
 * Grava os achados novos numa varredura propria (a "verificacao do inventario"), ja concluida,
 * no ativo da estacao. A unicidade workstationId + cve + programa descarta o que outra
 * verificacao simultanea ja gravou; se nada sobrar, a varredura vazia e desfeita (rollback).
 * Cada achado novo ganha o evento de criacao do historico de status (B25b) na mesma transacao.
 */
export async function registrarAchados(
  assetId: string,
  workstationId: string,
  achados: Omit<Prisma.FindingCreateManyInput, 'scanId' | 'workstationId'>[],
): Promise<{ scanId: string | null; criados: number }> {
  if (!achados.length) return { scanId: null, criados: 0 };
  try {
    return await prisma.$transaction(async (tx) => {
      const agora = new Date();
      const scan = await tx.scan.create({ data: { assetId, status: 'CONCLUIDA', criadoEm: agora, concluidoEm: agora } });
      const { count } = await tx.finding.createMany({
        data: achados.map((a) => ({ ...a, scanId: scan.id, workstationId, criadoEm: agora })),
        skipDuplicates: true,
      });
      if (count === 0) throw new NadaNovo();
      // B25b: o evento de criacao dos achados novos (a varredura acabou de nascer) na mesma transacao.
      await registrarCriacaoDosAchados(tx, scan.id);
      return { scanId: scan.id, criados: count };
    }, TRANSACAO_ACHADOS);
  } catch (e) {
    if (e instanceof NadaNovo) return { scanId: null, criados: 0 };
    throw e;
  }
}

export function marcarVerificada(id: string, verificadaEm: Date) {
  return prisma.workstation.update({ where: { id }, data: { verificadaEm } });
}
