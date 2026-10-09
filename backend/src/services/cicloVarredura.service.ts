import { randomInt } from 'node:crypto';
// Ciclo de vida da varredura SIMULADA: EM_FILA -> EM_ANDAMENTO -> CONCLUIDA.
//
// E uma maquina de estados avaliada na leitura, nao um worker: nao ha timer em segundo
// plano, porque a API tambem roda como funcao serverless (api/index.ts), que congela depois
// de responder. Para o usuario o efeito e o de segundo plano: ele dispara, sai da tela e,
// quando qualquer leitura acontece (lista, detalhe, dashboard, ativos, vulnerabilidades),
// o status ja avancou. O worker de verdade fica para o modo real (W01/W09).
// O status sai do tempo decorrido desde `criadoEm` e e gravado no banco na primeira leitura
// que perceber a mudanca (avancarVarreduras).
//
// Os achados so nascem na conclusao: varredura em fila ou em andamento nao tem achado,
// entao nenhuma tela ou indicador precisa filtrar "achado de varredura nao concluida".
import { CATALOGO_ACHADOS, dadosAchado, type ChaveAchado } from '../models/catalogoAchado.model.js';
import type { StatusVarredura } from '../models/varredura.model.js';
import * as repo from '../repositories/varredura.repository.js';

/** Tempo na fila antes de "comecar". */
export const TEMPO_EM_FILA_MS = 5_000;
/** Duracao total, da criacao a conclusao. */
export const DURACAO_VARREDURA_MS = 20_000;

export type { StatusVarredura };

/** Status que a varredura deve ter pelo tempo decorrido desde a criacao. */
export function statusPorTempo(criadoEm: Date, agora: Date = new Date()): StatusVarredura {
  const decorrido = agora.getTime() - criadoEm.getTime();
  if (decorrido >= DURACAO_VARREDURA_MS) return 'CONCLUIDA';
  if (decorrido >= TEMPO_EM_FILA_MS) return 'EM_ANDAMENTO';
  return 'EM_FILA';
}

// ---- Progresso (B26) -----------------------------------------------------------
//
// Tambem derivado na leitura, de `criadoEm` e das constantes acima: nada novo e gravado.
// Na fila o progresso e 0; no andamento cresce de 1 a 99, passando pelas etapas abaixo
// (distribuidas por igual no tempo do andamento); so a conclusao e 100.

export const ETAPA_FILA = 'Na fila';
export const ETAPA_CONCLUIDA = 'Concluída';
/** Etapas do andamento, em ordem; cada uma ocupa a mesma fatia do tempo de andamento. */
export const ETAPAS_ANDAMENTO = ['Mapeando superfície', 'Testando injeção', 'Testando autenticação', 'Gerando relatório'] as const;

export interface ProgressoVarredura {
  /** 0 a 100: 0 na fila, 1 a 99 no andamento, 100 na conclusao. */
  progresso: number;
  /** Etapa legivel ("Na fila", uma de ETAPAS_ANDAMENTO ou "Concluída"). */
  etapa: string;
  /** Quando a varredura conclui (ou concluiu), em ISO 8601. */
  estimativaConclusao: string;
}

function noAndamento(decorrido: number): Pick<ProgressoVarredura, 'progresso' | 'etapa'> {
  const fracao = Math.min(1, Math.max(0, (decorrido - TEMPO_EM_FILA_MS) / (DURACAO_VARREDURA_MS - TEMPO_EM_FILA_MS)));
  const progresso = Math.min(99, Math.max(1, Math.floor(fracao * 100)));
  const etapa = ETAPAS_ANDAMENTO[Math.min(ETAPAS_ANDAMENTO.length - 1, Math.floor(fracao * ETAPAS_ANDAMENTO.length))];
  return { progresso, etapa };
}

/** Progresso que o tempo decorrido desde a criacao determina (com o status correspondente). */
export function progressoPorTempo(criadoEm: Date, agora: Date = new Date()): ProgressoVarredura & { status: StatusVarredura } {
  const estimativaConclusao = new Date(criadoEm.getTime() + DURACAO_VARREDURA_MS).toISOString();
  const status = statusPorTempo(criadoEm, agora);
  if (status === 'EM_FILA') return { status, progresso: 0, etapa: ETAPA_FILA, estimativaConclusao };
  if (status === 'CONCLUIDA') return { status, progresso: 100, etapa: ETAPA_CONCLUIDA, estimativaConclusao };
  return { status, ...noAndamento(agora.getTime() - criadoEm.getTime()), estimativaConclusao };
}

/**
 * Progresso coerente com o status GRAVADO (que avancarVarreduras ja alinhou ao tempo):
 * concluida e sempre 100 (inclusive a do seed:demo, que nasce concluida) e o andamento nunca
 * chega a 100 antes de o status mudar no banco. Assim status e progresso nunca se contradizem.
 */
export function progressoDaVarredura(
  scan: { status: string; criadoEm: Date; concluidoEm: Date | null },
  agora: Date = new Date(),
): ProgressoVarredura {
  const previsto = new Date(scan.criadoEm.getTime() + DURACAO_VARREDURA_MS);
  if (scan.status === 'CONCLUIDA')
    return { progresso: 100, etapa: ETAPA_CONCLUIDA, estimativaConclusao: (scan.concluidoEm ?? previsto).toISOString() };
  if (scan.status === 'EM_FILA') return { progresso: 0, etapa: ETAPA_FILA, estimativaConclusao: previsto.toISOString() };
  return { ...noAndamento(agora.getTime() - scan.criadoEm.getTime()), estimativaConclusao: previsto.toISOString() };
}

// Varredura simulada: sorteia de 2 a 4 tipos distintos do catalogo (models/catalogoAchado.model.ts).
export function gerarFindings() {
  const qtd = 2 + randomInt(3);
  const chaves = Object.keys(CATALOGO_ACHADOS) as ChaveAchado[];
  const escolhidos: ChaveAchado[] = [];
  for (let i = 0; i < qtd && chaves.length; i++) {
    escolhidos.push(chaves.splice(randomInt(chaves.length), 1)[0]);
  }
  return escolhidos.map(dadosAchado);
}

async function concluir(scan: { id: string; criadoEm: Date }): Promise<void> {
  // Data "real" da conclusao (criacao + duracao), nao a hora em que alguem leu.
  const concluidoEm = new Date(scan.criadoEm.getTime() + DURACAO_VARREDURA_MS);
  // Os achados so sao sorteados se esta leitura vencer a troca de status (ver o repository).
  await repo.concluirComAchados(scan.id, concluidoEm, () =>
    gerarFindings().map((f) => ({ ...f, scanId: scan.id, criadoEm: concluidoEm })),
  );
}

/** Grava no banco o status que o tempo decorrido ja determina (e os achados de quem concluiu). */
export async function avancarVarreduras(agora: Date = new Date()): Promise<void> {
  const limiteFila = new Date(agora.getTime() - TEMPO_EM_FILA_MS);
  const limiteConclusao = new Date(agora.getTime() - DURACAO_VARREDURA_MS);
  await repo.iniciarAndamento(limiteFila, limiteConclusao);
  const vencidas = await repo.listarVencidas(limiteConclusao);
  for (const scan of vencidas) await concluir(scan);
}
