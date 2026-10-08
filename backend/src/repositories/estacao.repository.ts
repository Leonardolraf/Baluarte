import { prisma } from '../config/db.js';
import type { EstacaoComContagem, EstacaoComInventario } from '../models/estacao.model.js';

// Acesso ao banco do painel de estacoes (B13): so leitura das tabelas que o agente
// osquery preenche (Workstation, WorkstationSoftware, WorkstationPort).

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
