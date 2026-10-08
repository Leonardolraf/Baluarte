// Ciclo de vida da varredura SIMULADA: EM_FILA -> EM_ANDAMENTO -> CONCLUIDA.
//
// Nao ha timer em segundo plano: a API tambem roda como funcao serverless (api/index.ts),
// que congela depois de responder. O status sai do tempo decorrido desde `criadoEm` e e
// gravado no banco na primeira leitura que perceber a mudanca (avancarVarreduras).
//
// Os achados so nascem na conclusao: varredura em fila ou em andamento nao tem achado,
// entao nenhuma tela ou indicador precisa filtrar "achado de varredura nao concluida".
import { prisma } from '../../platform/db.js';
import { CATALOGO_ACHADOS, dadosAchado, type ChaveAchado } from './catalogo.js';

/** Tempo na fila antes de "comecar". */
export const TEMPO_EM_FILA_MS = 5_000;
/** Duracao total, da criacao a conclusao. */
export const DURACAO_VARREDURA_MS = 20_000;

export type StatusVarredura = 'EM_FILA' | 'EM_ANDAMENTO' | 'CONCLUIDA';

/** Status que a varredura deve ter pelo tempo decorrido desde a criacao. */
export function statusPorTempo(criadoEm: Date, agora: Date = new Date()): StatusVarredura {
  const decorrido = agora.getTime() - criadoEm.getTime();
  if (decorrido >= DURACAO_VARREDURA_MS) return 'CONCLUIDA';
  if (decorrido >= TEMPO_EM_FILA_MS) return 'EM_ANDAMENTO';
  return 'EM_FILA';
}

// Varredura simulada: sorteia de 2 a 4 tipos distintos do catalogo (src/catalogo.ts).
export function gerarFindings() {
  const qtd = 2 + Math.floor(Math.random() * 3);
  const chaves = Object.keys(CATALOGO_ACHADOS) as ChaveAchado[];
  const escolhidos: ChaveAchado[] = [];
  for (let i = 0; i < qtd && chaves.length; i++) {
    escolhidos.push(chaves.splice(Math.floor(Math.random() * chaves.length), 1)[0]);
  }
  return escolhidos.map(dadosAchado);
}

async function concluir(scan: { id: string; criadoEm: Date }): Promise<void> {
  // Data "real" da conclusao (criacao + duracao), nao a hora em que alguem leu.
  const concluidoEm = new Date(scan.criadoEm.getTime() + DURACAO_VARREDURA_MS);
  await prisma.$transaction(async (tx) => {
    // So uma leitura concorrente vence a troca de status; a outra recebe count 0 e sai.
    const { count } = await tx.scan.updateMany({
      where: { id: scan.id, status: { not: 'CONCLUIDA' } },
      data: { status: 'CONCLUIDA', concluidoEm },
    });
    if (count === 0) return;
    // Varredura criada antes desta regra ja nasceu com achados: nao duplica.
    if ((await tx.finding.count({ where: { scanId: scan.id } })) > 0) return;
    await tx.finding.createMany({
      data: gerarFindings().map((f) => ({ ...f, scanId: scan.id, criadoEm: concluidoEm })),
    });
  });
}

/** Grava no banco o status que o tempo decorrido ja determina (e os achados de quem concluiu). */
export async function avancarVarreduras(agora: Date = new Date()): Promise<void> {
  const limiteFila = new Date(agora.getTime() - TEMPO_EM_FILA_MS);
  const limiteConclusao = new Date(agora.getTime() - DURACAO_VARREDURA_MS);
  await prisma.scan.updateMany({
    where: { status: 'EM_FILA', criadoEm: { lte: limiteFila, gt: limiteConclusao } },
    data: { status: 'EM_ANDAMENTO' },
  });
  const vencidas = await prisma.scan.findMany({
    where: { status: { not: 'CONCLUIDA' }, criadoEm: { lte: limiteConclusao } },
    select: { id: true, criadoEm: true },
  });
  for (const scan of vencidas) await concluir(scan);
}
