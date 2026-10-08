import { SEVERIDADES, STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import {
  DIAS_EVOLUCAO,
  FUSO_EVOLUCAO,
  type ContagemSeveridade,
  type DiaEvolucao,
  type PontoEvolucao,
} from '../models/dashboard.model.js';
import { contarCriadosAte } from '../repositories/ativo.repository.js';
import { abertosPorDia } from '../repositories/vulnerabilidade.repository.js';
import { contarArquivosMaliciososAte } from './analiseArquivo.service.js';
import { indiceRiscoTecnico } from './indiceRisco.service.js';

// Evolucao do risco nos ultimos 30 dias (B25b), SEM cron nem foto diaria: reconstruida a cada
// leitura do dashboard a partir do historico de status (tabela FindingStatusChange).
//
// Para cada dia D (no fuso de Brasilia, o mesmo do relatorio em PDF), ao fim de D:
// - achados abertos por severidade: criado ate D e o ultimo evento ate D o deixa num status
//   aberto (fora de "Resolvida" e "Risco aceito"); hoje vale o status gravado (o fato atual);
// - arquivos maliciosos (B17): distintos por SHA-256 com AMEACA nos 30 dias que terminam em D;
// - ativos: os que ja existiam em D (capacidade do indice);
// - indice: a mesma formula do KPI `indiceRiscoTecnico` (services/indiceRisco.service.ts).
// Por isso o ultimo ponto (hoje) e exatamente o KPI do dashboard.
//
// Custo: tres consultas por leitura (achados, arquivos e ativos por dia); a dos achados faz
// ~30 buscas por achado no indice do historico. Ver `abertosPorDia` no repository.

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Partes da data e hora de um instante no fuso (relogio de 24 h). */
function partesNoFuso(instante: Date, fuso: string) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: valor('year'), mes: valor('month'), dia: valor('day'), hora: valor('hour'), minuto: valor('minute'), segundo: valor('second') };
}

/** Diferenca entre o relogio do fuso e o UTC num instante, em ms (Brasilia: -3 h). */
function deslocamento(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - (instante.getTime() - instante.getUTCMilliseconds());
}

/** Instante da meia-noite local de uma data (ano, mes 1-12, dia) no fuso. */
export function inicioDoDia(ano: number, mes: number, dia: number, fuso: string = FUSO_EVOLUCAO): Date {
  const meiaNoiteUtc = Date.UTC(ano, mes - 1, dia);
  // Duas passadas acertam o deslocamento mesmo num dia de mudanca de horario de verao.
  let instante = meiaNoiteUtc - deslocamento(new Date(meiaNoiteUtc), fuso);
  instante = meiaNoiteUtc - deslocamento(new Date(instante), fuso);
  return new Date(instante);
}

/** AAAA-MM-DD de um instante no fuso. */
export function dataNoFuso(instante: Date, fuso: string = FUSO_EVOLUCAO): string {
  const p = partesNoFuso(instante, fuso);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/**
 * Os `dias` dias que terminam hoje, do mais antigo ao mais recente. Cada dia termina 1 ms antes
 * da meia-noite local seguinte (o banco guarda milissegundos); hoje termina em `agora`.
 */
export function diasDaJanela(agora: Date, dias: number = DIAS_EVOLUCAO, fuso: string = FUSO_EVOLUCAO): DiaEvolucao[] {
  const hoje = partesNoFuso(agora, fuso);
  return Array.from({ length: dias }, (_, i) => {
    const atras = dias - 1 - i;
    // Aritmetica de calendario em UTC (sem fuso): so serve para achar ano, mes e dia.
    const data = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia - atras));
    const seguinte = new Date(data.getTime() + UM_DIA_MS);
    const fim =
      atras === 0
        ? agora
        : new Date(inicioDoDia(seguinte.getUTCFullYear(), seguinte.getUTCMonth() + 1, seguinte.getUTCDate(), fuso).getTime() - 1);
    return { data: data.toISOString().slice(0, 10), fim };
  });
}

/**
 * Monta os pontos a partir das contagens ja feitas (puro, testavel sem banco). `abertos` traz
 * uma linha por dia e severidade (dia 1 = o primeiro de `dias`); `arquivos` e `ativos`, um
 * numero por dia, na ordem de `dias`.
 */
export function montarEvolucao(
  dias: DiaEvolucao[],
  abertos: Array<{ dia: number; severidade: string; total: number }>,
  arquivos: number[],
  ativos: number[],
): PontoEvolucao[] {
  const porDia = new Map<number, ContagemSeveridade>();
  for (const { dia, severidade, total } of abertos) {
    const contagem = porDia.get(Number(dia)) ?? Object.fromEntries(SEVERIDADES.map((s) => [s, 0]));
    contagem[severidade] = (contagem[severidade] ?? 0) + Number(total);
    porDia.set(Number(dia), contagem);
  }
  return dias.map(({ data }, i) => {
    const c = porDia.get(i + 1) ?? {};
    const [critico, alto, medio, baixo] = SEVERIDADES.map((s) => c[s] ?? 0);
    const arquivosMaliciosos = arquivos[i] ?? 0;
    const totalAtivos = ativos[i] ?? 0;
    return {
      data,
      critico,
      alto,
      medio,
      baixo,
      arquivosMaliciosos,
      ativos: totalAtivos,
      // Como no KPI: cada arquivo malicioso pesa como um critico.
      indice: indiceRiscoTecnico(
        { 'Crítico': critico + arquivosMaliciosos, 'Alto': alto, 'Médio': medio, 'Baixo': baixo },
        totalAtivos,
      ),
    };
  });
}

/** Evolucao do risco nos ultimos 30 dias (hoje incluso), reconstruida do historico de status. */
export async function evolucaoRisco(agora: Date = new Date()): Promise<PontoEvolucao[]> {
  const dias = diasDaJanela(agora);
  const fins = dias.map((d) => d.fim);
  const [abertos, arquivos, ativos] = await Promise.all([
    abertosPorDia(fins, STATUS_FINDING_ENCERRADO),
    contarArquivosMaliciososAte(fins),
    contarCriadosAte(fins),
  ]);
  const ativosPorDia = new Map(ativos.map((a) => [Number(a.dia), Number(a.total)]));
  return montarEvolucao(
    dias,
    abertos,
    arquivos,
    fins.map((_, i) => ativosPorDia.get(i + 1) ?? 0),
  );
}
