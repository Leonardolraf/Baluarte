import { SEVERIDADES, STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import { LIMITE_MAIOR_RISCO, NOTA_RISCO_MAXIMA, type AbertosPorSeveridade, type RiscoAtivo } from '../models/ativo.model.js';
import * as repo from '../repositories/ativo.repository.js';
import { pontosDeRisco } from './indiceRisco.service.js';

export { pontosDeRisco };

// Nota de risco por ativo (B25), calculada NA LEITURA e nunca gravada:
//
//   pontos = soma de PESO_SEVERIDADE x abertos da severidade   (proposta 10/7/4/1; so abertos)
//   nota   = min(100, pontos)
//
// "Aberto" e a mesma regra dos KPIs do dashboard: "Resolvida" e "Risco aceito" nao contam.
// Como nada e persistido, a nota acompanha qualquer mudanca (varredura concluida, status
// alterado) ja na leitura seguinte: e o "recalculada a cada mudanca" do requisito, sem
// gatilho nem coluna nova. Os pesos sao PESO_SEVERIDADE (models/dominio.model.ts), os mesmos do
// indice global e da evolucao do risco (B25b); os pontos saem de services/indiceRisco.service.ts.

/** As quatro severidades zeradas, na ordem oficial. */
export function abertosVazio(): AbertosPorSeveridade {
  return Object.fromEntries(SEVERIDADES.map((s) => [s, 0]));
}

/** Nota de 0 a 100 do ativo. */
export function notaDeRisco(abertos: AbertosPorSeveridade): number {
  return Math.min(NOTA_RISCO_MAXIMA, pontosDeRisco(abertos));
}

/** Risco do ativo a partir das contagens (ativo sem achado aberto: nota 0). */
export function riscoDe(abertos: AbertosPorSeveridade = abertosVazio()): RiscoAtivo {
  const completo = { ...abertosVazio(), ...abertos };
  return {
    notaRisco: notaDeRisco(completo),
    achadosAbertos: SEVERIDADES.reduce((n, s) => n + completo[s], 0),
    abertosPorSeveridade: completo,
  };
}

/** Achados abertos de cada ativo por severidade (so ativos com pelo menos um aberto). */
export async function abertosPorAtivo(): Promise<Map<string, AbertosPorSeveridade>> {
  const linhas = await repo.contarAbertosPorAtivo(STATUS_FINDING_ENCERRADO);
  const mapa = new Map<string, AbertosPorSeveridade>();
  for (const { ativoId, severidade, total } of linhas) {
    const abertos = mapa.get(ativoId) ?? abertosVazio();
    abertos[severidade] = (abertos[severidade] ?? 0) + Number(total);
    mapa.set(ativoId, abertos);
  }
  return mapa;
}

type AtivoComRisco = RiscoAtivo & { id: string; nome: string; host: string };

/**
 * Ordem do ranking: maior nota; empate (inclusive no teto) pelos pontos sem teto, depois por
 * criticos, altos, medios e baixos abertos; por fim nome e id, para a ordem nunca variar.
 */
export function compararRisco(a: AtivoComRisco, b: AtivoComRisco): number {
  return (
    b.notaRisco - a.notaRisco ||
    pontosDeRisco(b.abertosPorSeveridade) - pontosDeRisco(a.abertosPorSeveridade) ||
    SEVERIDADES.reduce((d, s) => d || b.abertosPorSeveridade[s] - a.abertosPorSeveridade[s], 0) ||
    a.nome.localeCompare(b.nome, 'pt-BR') ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Os ativos de maior risco (so quem tem achado aberto; ate `limite`). */
export async function ativosMaiorRisco(limite = LIMITE_MAIOR_RISCO): Promise<AtivoComRisco[]> {
  const abertos = await abertosPorAtivo();
  if (abertos.size === 0) return [];
  const ativos = await repo.listarResumoPorIds([...abertos.keys()]);
  return ativos
    .map((a) => ({ id: a.id, nome: a.nome, host: a.host, ...riscoDe(abertos.get(a.id)) }))
    .sort(compararRisco)
    .slice(0, limite);
}
