import type { FileScan } from '@prisma/client';
import type { Estatisticas } from '../config/virustotal.js';

// Segunda opiniao do VirusTotal sobre um arquivo analisado (B20). Consultada so pelo SHA-256,
// depois do ClamAV; o veredito principal (resultado LIMPO/AMEACA) nunca muda por causa dela.

export const SITUACOES_SEGUNDA_OPINIAO = ['MALICIOSO', 'SUSPEITO', 'SEM_DETECCAO', 'DESCONHECIDO', 'INDISPONIVEL', 'DESLIGADO'] as const;
export type SituacaoSegundaOpiniao = (typeof SITUACOES_SEGUNDA_OPINIAO)[number];

export const MOTIVOS_INDISPONIVEL = ['COTA', 'CHAVE_INVALIDA', 'LIMITE_VIRUSTOTAL', 'TEMPO_ESGOTADO', 'FALHA'] as const;
export type MotivoIndisponibilidade = (typeof MOTIVOS_INDISPONIVEL)[number];

/** Pagina publica do relatorio no VirusTotal (so o hash vai no endereco). */
export function linkRelatorio(sha256: string): string {
  return `https://www.virustotal.com/gui/file/${sha256}`;
}

/** Situacoes que vieram de uma resposta do VirusTotal e podem ser reaproveitadas pelo cache. */
export const SITUACOES_CACHEAVEIS: SituacaoSegundaOpiniao[] = ['MALICIOSO', 'SUSPEITO', 'SEM_DETECCAO', 'DESCONHECIDO'];

/** Cota gratuita da API publica do VirusTotal (configuravel no .env). */
export const COTA_POR_MINUTO_PADRAO = 4;
export const COTA_POR_DIA_PADRAO = 500;
/** Validade do resultado guardado (horas) antes de consultar o mesmo hash de novo. */
export const VALIDADE_CACHE_HORAS_PADRAO = 24;

/** O que fica gravado no FileScan (colunas vt*). */
export interface SegundaOpiniaoGravada {
  vtSituacao: SituacaoSegundaOpiniao;
  vtMotivo: MotivoIndisponibilidade | null;
  vtDeteccoes: number | null;
  vtTotal: number | null;
  vtConsultadoEm: Date | null;
}

/** Segunda opiniao como a API devolve. */
export interface SegundaOpiniaoDto {
  fonte: 'VirusTotal';
  situacao: SituacaoSegundaOpiniao;
  motivo: MotivoIndisponibilidade | null;
  deteccoes: number | null;
  total: number | null;
  consultadoEm: Date | null;
  link: string;
  mensagem: string;
}

/**
 * Veredito a partir de `last_analysis_stats`: deteccoes = mecanismos que marcaram malicioso ou
 * suspeito; total = os que deram veredito (malicioso, suspeito, nao detectado, inofensivo).
 * Sem nenhum mecanismo com veredito, o VirusTotal ainda nao tem analise: DESCONHECIDO.
 */
export function vereditoDe(e: Estatisticas): Pick<SegundaOpiniaoGravada, 'vtSituacao' | 'vtDeteccoes' | 'vtTotal'> {
  const total = e.malicious + e.suspicious + e.undetected + e.harmless;
  if (total === 0) return { vtSituacao: 'DESCONHECIDO', vtDeteccoes: null, vtTotal: null };
  const vtSituacao = e.malicious > 0 ? 'MALICIOSO' : e.suspicious > 0 ? 'SUSPEITO' : 'SEM_DETECCAO';
  return { vtSituacao, vtDeteccoes: e.malicious + e.suspicious, vtTotal: total };
}

const MOTIVO_TEXTO: Record<MotivoIndisponibilidade, string> = {
  COTA: 'cota',
  CHAVE_INVALIDA: 'chave do VirusTotal recusada',
  LIMITE_VIRUSTOTAL: 'limite do VirusTotal',
  TEMPO_ESGOTADO: 'o VirusTotal não respondeu a tempo',
  FALHA: 'falha ao consultar o VirusTotal',
};

/** Texto para quem le. Como no ClamAV, nunca afirma que o arquivo e seguro. */
export function mensagemSegundaOpiniao(g: SegundaOpiniaoGravada): string {
  switch (g.vtSituacao) {
    case 'MALICIOSO':
      return `${g.vtDeteccoes} de ${g.vtTotal} mecanismos do VirusTotal detectaram este arquivo como malicioso ou suspeito`;
    case 'SUSPEITO':
      return `${g.vtDeteccoes} de ${g.vtTotal} mecanismos do VirusTotal marcaram este arquivo como suspeito`;
    case 'SEM_DETECCAO':
      return `Nenhum dos ${g.vtTotal} mecanismos do VirusTotal detectou ameaça conhecida neste arquivo`;
    case 'DESCONHECIDO':
      return 'O VirusTotal não tem relatório deste arquivo (consultado só pelo SHA-256; o arquivo não foi enviado)';
    case 'INDISPONIVEL':
      return `Segunda opinião indisponível agora (${MOTIVO_TEXTO[g.vtMotivo ?? 'FALHA']})`;
    default:
      return 'Segunda opinião do VirusTotal desligada neste ambiente';
  }
}

/** Monta o DTO a partir das colunas do FileScan; analise anterior ao B20 (sem consulta) da null. */
export function segundaOpiniaoDto(r: Pick<FileScan, 'sha256' | 'vtSituacao' | 'vtMotivo' | 'vtDeteccoes' | 'vtTotal' | 'vtConsultadoEm'>): SegundaOpiniaoDto | null {
  if (!r.vtSituacao) return null;
  const g = r as SegundaOpiniaoGravada;
  return {
    fonte: 'VirusTotal',
    situacao: g.vtSituacao,
    motivo: g.vtMotivo,
    deteccoes: g.vtDeteccoes,
    total: g.vtTotal,
    consultadoEm: g.vtConsultadoEm,
    link: linkRelatorio(r.sha256),
    mensagem: mensagemSegundaOpiniao(g),
  };
}

/** Le um inteiro positivo do .env, com padrao. */
export function inteiroDoAmbiente(nome: string, padrao: number): number {
  const v = Number(process.env[nome]);
  return Number.isInteger(v) && v > 0 ? v : padrao;
}
