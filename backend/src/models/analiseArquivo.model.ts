import type { FileScan } from '@prisma/client';
import { z } from 'zod';
import { idRecurso, regra, regrasDePaginacao, seVeio, umDe } from '../utils/esquemas.js';
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
  /** B23: a deteccao veio de uma regra YARA propria do Baluarte (antivirus/regras), nao do ClamAV. */
  regraPropria: boolean;
  /** B23: anexo suspeito de uma campanha de phishing simulado; null no envio avulso. */
  campanha: CampanhaDeOrigem | null;
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

// ---- Regras YARA proprias (B23) -------------------------------------------------------

/**
 * O ClamAV nomeia a deteccao de uma regra YARA como `YARA.<regra>.UNOFFICIAL`. As regras do
 * Baluarte (antivirus/regras/baluarte_*.yar) comecam com `Baluarte`; so elas ganham o rotulo de
 * regra propria. Regra YARA de terceiros que alguem jogue no diretorio de banco nao ganha.
 */
const DETECCAO_REGRA_PROPRIA = /^YARA\.Baluarte[A-Za-z0-9_]*\.UNOFFICIAL$/;

/** A ameaca encontrada veio de uma regra propria do Baluarte? */
export function ehRegraPropria(ameaca: string | null | undefined): boolean {
  return typeof ameaca === 'string' && DETECCAO_REGRA_PROPRIA.test(ameaca);
}

/** Rotulo que acompanha a deteccao de regra propria na mensagem e na tela. */
export const ROTULO_REGRA_PROPRIA = 'regra própria do Baluarte';

/** Mensagem do resultado: a deteccao de regra propria diz de onde veio. */
export function mensagemDoResultado(ameaca: string | null): string {
  if (!ameaca) return MENSAGEM_LIMPO;
  return ehRegraPropria(ameaca) ? `${mensagemAmeaca(ameaca)} (${ROTULO_REGRA_PROPRIA})` : mensagemAmeaca(ameaca);
}

// ---- Anexo suspeito de campanha (B23) -------------------------------------------------

/** Campanha de onde veio o anexo (o id e o da campanha, para a tela; nunca o token do link). */
export interface CampanhaDeOrigem {
  id: string;
  nome: string;
}

/**
 * Anexos por destinatario em cada campanha. Um e-mail de phishing raramente traz mais que dois
 * ou tres anexos; o teto impede que um envio repetido infle o relatorio da campanha. O limite
 * por hora (LIMITE_ANALISES_POR_HORA) e o de tamanho continuam valendo.
 */
export const LIMITE_ANEXOS_POR_CAMPANHA = 5;

/** Token do link do e-mail da campanha (gerarTokenLink: 32 bytes em hexadecimal). */
const tokenDeLink = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Query de POST /arquivos/analise. A origem vai na query (e nao num campo do multipart) para ser
 * conferida ANTES de ler o corpo: campanha alheia ou inexistente nem chega a ocupar o antivirus.
 */
export const ORIGEM_ANALISE = [
  regra('eventoCampanha', seVeio(idRecurso), 'Campanha de origem inválida', 'EVENTO_CAMPANHA_INVALIDO'),
];

/** Query de GET /arquivos/campanhas-recebidas: `link` opcional (token do e-mail) para pre-selecionar. */
export const CONSULTA_CAMPANHAS_RECEBIDAS = [
  regra('link', seVeio(tokenDeLink), 'Link de campanha inválido', 'LINK_INVALIDO'),
];

/** Campanha recebida pelo usuario, como a tela de analise lista. */
export interface CampanhaRecebidaDto {
  /** id do evento (destinatario na campanha): e o que vai em `eventoCampanha` no envio. */
  id: string;
  campanha: CampanhaDeOrigem;
  recebidaEm: Date | null;
  anexosEnviados: number;
}

/** Anexo reportado, como o relatorio da campanha mostra aos operadores. */
export interface AnexoCampanhaDto {
  id: string;
  nome: string;
  sha256: string;
  resultado: ResultadoAnalise;
  ameaca: string | null;
  regraPropria: boolean;
  analisadoEm: Date;
  destinatario: string;
}
