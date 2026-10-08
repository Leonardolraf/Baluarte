import type { FileScan } from '@prisma/client';
import { regra, regrasDePaginacao, seVeio, umDe } from '../utils/esquemas.js';
import type { SegundaOpiniaoDto } from './segundaOpiniao.model.js';

// Analise de arquivo pelo antivirus (B04). O arquivo nunca e gravado: passa em fluxo pelo
// ClamAV e e descartado; fica so o registro (nome para exibir, tamanho, SHA-256, veredito).

export type AnaliseArquivo = FileScan;

/** Tamanho maximo aceito por arquivo (o mesmo que a tela barra antes de enviar). */
export const LIMITE_ARQUIVO_BYTES = 10 * 1024 * 1024;

/** Analises por usuario por hora (o antivirus e caro: cada envio ocupa o clamd). */
export const LIMITE_ANALISES_POR_HORA = 20;

/** Campo do formulario multipart que leva o arquivo. */
export const CAMPO_ARQUIVO = 'arquivo';

/** O resultado diz o que o antivirus sabe: ameaca CONHECIDA. Nunca afirma "arquivo seguro". */
export const MENSAGEM_LIMPO = 'Nenhuma ameaça conhecida encontrada';
export const mensagemAmeaca = (ameaca: string) => `Ameaça encontrada: ${ameaca}`;

/** Veredito do antivirus (espelha a CHECK da coluna `resultado`). */
export const RESULTADOS_ANALISE = ['LIMPO', 'AMEACA'] as const;
export type ResultadoAnalise = (typeof RESULTADOS_ANALISE)[number];

// ---- Historico (GET /arquivos/analises, B17) --------------------------------------

/** Tamanho padrao e maximo da pagina do historico. */
export const TAMANHO_PAGINA_PADRAO = 20;
export const TAMANHO_PAGINA_MAXIMO = 100;

/** Filtros ja validados e convertidos. */
export interface FiltrosHistorico {
  resultado?: ResultadoAnalise;
  pagina: number;
  tamanho: number;
}

/** Regras da query do historico, na ordem em que sao checadas (objeto/array da 400, nunca 500). */
export const CONSULTA_HISTORICO = [
  regra(
    'resultado',
    seVeio(umDe(RESULTADOS_ANALISE)),
    'Filtro de resultado inválido: use LIMPO ou AMEACA',
    'RESULTADO_INVALIDO',
  ),
  ...regrasDePaginacao(TAMANHO_PAGINA_MAXIMO),
];

// ---- Peso no dashboard (B17) -------------------------------------------------------

/**
 * Janela dos arquivos maliciosos no risco tecnico: so as deteccoes dos ultimos 30 dias contam.
 * O arquivo e descartado na analise e nao tem status para "resolver"; sem janela, uma deteccao
 * antiga pesaria como critica para sempre.
 */
export const JANELA_ARQUIVOS_MALICIOSOS_DIAS = 30;

/** Analise como a API devolve. `usuario` so aparece para Administrador/Analista. */
export interface AnaliseDto {
  id: string;
  nome: string;
  tamanho: number;
  sha256: string;
  resultado: ResultadoAnalise;
  ameaca: string | null;
  analisadoEm: Date;
  /** Segunda opiniao do VirusTotal (B20); null nas analises anteriores a ela. Nao muda `resultado`. */
  segundaOpiniao: SegundaOpiniaoDto | null;
  usuario?: { nome: string; email: string };
}

/**
 * Nome so para exibir: sem caminho (fica o ultimo trecho depois de / ou \), sem caracteres de
 * controle, ate 255 caracteres. Nunca e usado como caminho de arquivo.
 */
export function nomeParaExibir(original: string | undefined): string {
  const base = (original ?? '').split(/[\\/]/).pop() ?? '';
  const limpo = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return limpo || 'arquivo-sem-nome';
}
