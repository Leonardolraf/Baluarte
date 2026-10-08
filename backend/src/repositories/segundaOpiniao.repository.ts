import { prisma } from '../config/db.js';
import { SITUACOES_CACHEAVEIS } from '../models/segundaOpiniao.model.js';

// Acesso a dados da segunda opiniao do VirusTotal (B20): cache (a analise mais recente do mesmo
// SHA-256 no FileScan) e cota de consultas (tabela VirusTotalLookup).

/** Resultado guardado mais recente do hash, consultado a partir de `desde` (cache). */
export function buscarEmCache(sha256: string, desde: Date) {
  return prisma.fileScan.findFirst({
    where: { sha256, vtSituacao: { in: SITUACOES_CACHEAVEIS }, vtConsultadoEm: { gte: desde } },
    orderBy: { vtConsultadoEm: 'desc' },
    select: { vtSituacao: true, vtDeteccoes: true, vtTotal: true, vtConsultadoEm: true },
  });
}

/**
 * Reserva uma consulta na cota: grava primeiro e conta depois, incluindo a propria reserva.
 * Duas requisicoes simultaneas nunca passam juntas do limite (no pior caso, as duas desistem).
 * Devolve o id da reserva e as contagens na janela de um minuto e de um dia.
 */
export async function reservarConsulta(umMinutoAtras: Date, umDiaAtras: Date) {
  const reserva = await prisma.virusTotalLookup.create({ data: {} });
  const [noMinuto, noDia] = await Promise.all([
    prisma.virusTotalLookup.count({ where: { criadoEm: { gte: umMinutoAtras } } }),
    prisma.virusTotalLookup.count({ where: { criadoEm: { gte: umDiaAtras } } }),
  ]);
  return { id: reserva.id, noMinuto, noDia };
}

/** Desfaz uma reserva que passou do limite (a consulta nao foi feita). */
export function cancelarReserva(id: string) {
  return prisma.virusTotalLookup.delete({ where: { id } });
}

/** Poda: consultas fora da janela de um dia nao contam mais. */
export function apagarConsultasAntigas(antes: Date) {
  return prisma.virusTotalLookup.deleteMany({ where: { criadoEm: { lt: antes } } });
}
