import { PESO_SEVERIDADE, SEVERIDADES } from '../models/dominio.model.js';
import { INDICE_MAXIMO, PONTOS_POR_ATIVO, type ContagemSeveridade } from '../models/dashboard.model.js';

// Escala de risco por severidade num lugar so (B25b). Os pesos sao PESO_SEVERIDADE
// (models/dominio.model.ts, escala 10/7/4/1 aprovada pelo Leo em 10/10/2026, DT07):
//
//   pontos = soma de PESO_SEVERIDADE[s] x quantidade[s]   (com a escala: 10C + 7A + 4M + 1B)
//
// - nota do ativo (services/riscoAtivo.service.ts): min(100, pontos dos achados abertos do ativo);
// - indice de risco tecnico global (dashboard): min(100, round(pontos / (ativos x 20) x 100)),
//   com os arquivos maliciosos dos ultimos 30 dias (B17) somados aos criticos e pelo menos 1 ativo;
// - evolucao do risco (services/evolucaoRisco.service.ts): o mesmo indice, dia a dia.
// Ate o B25b o indice global era calculado no frontend com 10/6/3/1; agora sai daqui.

/** Pontos de risco sem teto de uma contagem por severidade (rotulo ausente conta zero). */
export function pontosDeRisco(contagem: ContagemSeveridade): number {
  return SEVERIDADES.reduce((soma, s) => soma + (PESO_SEVERIDADE[s] ?? 0) * (contagem[s] ?? 0), 0);
}

/**
 * Indice de risco tecnico global, de 0 a 100: pontos sobre a "capacidade" de 20 pontos por
 * ativo monitorado (pelo menos 1, para nao dividir por zero), arredondado, com teto 100.
 * `contagem` ja inclui os arquivos maliciosos no Critico (a distribuicao do dashboard).
 */
export function indiceRiscoTecnico(contagem: ContagemSeveridade, ativos: number): number {
  const capacidade = Math.max(1, ativos) * PONTOS_POR_ATIVO;
  return Math.max(0, Math.min(INDICE_MAXIMO, Math.round((pontosDeRisco(contagem) / capacidade) * 100)));
}
