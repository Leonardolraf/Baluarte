import { FUSO_RELATORIO } from './vulnerabilidade.model.js';

// Model do dashboard: constantes e tipos do indice de risco tecnico global e da evolucao do
// risco em 30 dias (B25b). Os pesos por severidade sao PESO_SEVERIDADE (models/dominio.model.ts).

/**
 * Escala do indice global: carga = pontos / (ativos x 20) e indice = 100 x (1 - e^(-carga)).
 * Com carga 1 (dois criticos abertos por ativo, ou combinacao de mesmo peso) o indice e 63;
 * ele so chega a 100 com carga perto de 5,3. Curva aprovada pelo Leo em 12/10/2026: a regua
 * linear antiga travava em 100 com dois criticos por ativo e nao mostrava melhora (1.515 -> 32
 * achados abertos e o indice parado em 100).
 */
export const PONTOS_POR_ATIVO = 20;

/** Teto do indice global (0 a 100, maior = pior). */
export const INDICE_MAXIMO = 100;

/** Dias da evolucao do risco (o ultimo e hoje). */
export const DIAS_EVOLUCAO = 30;

/** Fuso que define onde um dia comeca e termina na evolucao (o mesmo do relatorio em PDF). */
export const FUSO_EVOLUCAO = FUSO_RELATORIO;

/** Contagem por severidade (rotulos de SEVERIDADES). */
export type ContagemSeveridade = Record<string, number>;

/** Um dia da janela: a data local e o instante em que ele termina (hoje termina agora). */
export interface DiaEvolucao {
  /** AAAA-MM-DD no fuso FUSO_EVOLUCAO. */
  data: string;
  /** Ultimo instante do dia (milissegundo antes do dia seguinte); para hoje, o momento da leitura. */
  fim: Date;
}

/**
 * Um ponto da evolucao do risco, como GET /dashboard devolve em `evolucaoRisco`: achados abertos
 * por severidade ao fim do dia, os arquivos maliciosos da janela de 30 dias que terminava nele
 * (B17), os ativos que ja existiam e o indice global daquele dia (a mesma formula do KPI).
 */
export interface PontoEvolucao {
  data: string;
  critico: number;
  alto: number;
  medio: number;
  baixo: number;
  arquivosMaliciosos: number;
  ativos: number;
  indice: number;
}
