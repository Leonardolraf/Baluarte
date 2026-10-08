import { prisma } from '../config/db.js';
import { TIPO_ESTACAO } from '../models/dominio.model.js';
import type { FontePrograma, ItemPorta, ItemPrograma, SistemaOperacional } from '../models/agente.model.js';

// Acesso ao banco do agente osquery (B07): estacoes (Workstation) e o inventario mais
// recente de cada uma (WorkstationSoftware, WorkstationPort).

export function buscarPorHostIdentifier(hostIdentifier: string) {
  return prisma.workstation.findUnique({ where: { hostIdentifier } });
}

export function buscarPorNodeKeyHash(nodeKeyHash: string) {
  return prisma.workstation.findUnique({ where: { nodeKeyHash } });
}

export async function hostDeAtivoEmUso(host: string): Promise<boolean> {
  return (await prisma.asset.count({ where: { host } })) > 0;
}

/** Inscricao nova: cria o ativo do tipo "Estação de trabalho" e a estacao juntos. */
export function criarComAtivo(dados: {
  ativo: { nome: string; host: string };
  hostIdentifier: string;
  nodeKeyHash: string;
  so: SistemaOperacional;
}) {
  return prisma.workstation.create({
    data: {
      hostIdentifier: dados.hostIdentifier,
      nodeKeyHash: dados.nodeKeyHash,
      ...dados.so,
      asset: { create: { nome: dados.ativo.nome, host: dados.ativo.host, tipo: TIPO_ESTACAO, status: 'Ativo' } },
    },
  });
}

/** Reinscricao da mesma estacao: chave nova (a anterior deixa de valer) e SO atualizado. */
export function reinscrever(id: string, nodeKeyHash: string, so: SistemaOperacional) {
  return prisma.workstation.update({ where: { id }, data: { nodeKeyHash, ...so, vistaEm: new Date() } });
}

export function marcarVista(id: string) {
  return prisma.workstation.update({ where: { id }, data: { vistaEm: new Date() } });
}

export function atualizarSistema(id: string, so: SistemaOperacional) {
  const agora = new Date();
  return prisma.workstation.update({ where: { id }, data: { ...so, vistaEm: agora, inventarioEm: agora } });
}

/** Troca os programas de uma fonte pela lista do snapshot mais recente. */
export function substituirProgramas(id: string, fonte: FontePrograma, itens: ItemPrograma[]) {
  const agora = new Date();
  return prisma.$transaction([
    prisma.workstationSoftware.deleteMany({ where: { workstationId: id, fonte } }),
    prisma.workstationSoftware.createMany({
      data: itens.map((i) => ({ ...i, fonte, workstationId: id, coletadoEm: agora })),
      skipDuplicates: true,
    }),
    prisma.workstation.update({ where: { id }, data: { vistaEm: agora, inventarioEm: agora } }),
  ]);
}

/** Troca as portas em escuta pela lista do snapshot mais recente. */
export function substituirPortas(id: string, itens: ItemPorta[]) {
  const agora = new Date();
  return prisma.$transaction([
    prisma.workstationPort.deleteMany({ where: { workstationId: id } }),
    prisma.workstationPort.createMany({
      data: itens.map((i) => ({ ...i, workstationId: id, coletadoEm: agora })),
      skipDuplicates: true,
    }),
    prisma.workstation.update({ where: { id }, data: { vistaEm: agora, inventarioEm: agora } }),
  ]);
}

/** Estacao com o inventario completo (base do cruzamento com vulnerabilidades, B14). */
export function inventario(id: string) {
  return prisma.workstation.findUnique({
    where: { id },
    include: {
      asset: true,
      programas: { orderBy: [{ fonte: 'asc' }, { nome: 'asc' }] },
      portas: { orderBy: [{ porta: 'asc' }, { protocolo: 'asc' }] },
    },
  });
}
