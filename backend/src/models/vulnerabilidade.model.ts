import type { Finding } from '@prisma/client';
import { z } from 'zod';
import { notaCvss, regra, seVeio, umDe, umDeSemCaixa } from '../utils/esquemas.js';
import { SEVERIDADES, STATUS_FINDING } from './dominio.model.js';

// Model de vulnerabilidade (achado de varredura): tipos do dominio, DTOs e regras de entrada (zod).

/** Achado como esta no banco (tabela Finding). */
export type Vulnerabilidade = Finding;

/** Achado com a varredura e o ativo (o ativo e identificado pelo host na API). */
export type FindingComScan = {
  id: string; categoriaOwasp: string; cvss: number; severidade: string; descricao: string; evidencia: string;
  cwe: string | null; cve: string | null; cvssVetor: string | null; remediacao: unknown; status: string; criadoEm: Date;
  scan: { asset: { host: string; nome: string } };
};

/** Filtros da lista (GET /vulnerabilidades); so strings passam. */
export interface FiltrosVulnerabilidade {
  severidade?: string;
  status?: string;
  q?: string;
}

export const CLASSIFICACAO = [regra('cvss', notaCvss, 'CVSS deve estar entre 0.0 e 10.0', 'CVSS_INVALIDO')];
export const ALTERACAO_STATUS = [regra('status', umDe(STATUS_FINDING), 'Status inválido', 'STATUS_INVALIDO')];

// ---- Relatorio em PDF (B24, US-011) ---------------------------------------------

/** Fuso das datas do relatorio (data/hora de geracao, nome do arquivo e data dos achados). */
export const FUSO_RELATORIO = 'America/Sao_Paulo';

/** Tamanho maximo da busca livre aceita no relatorio. */
export const BUSCA_MAXIMA = 100;

/**
 * Regras da query de GET /vulnerabilidades/relatorio.pdf: os mesmos filtros da lista, mas
 * validados (a lista ignora valor desconhecido; o relatorio recusa com 400, para nunca
 * entregar um PDF que parece filtrado sem estar). Maiusculas nao importam, como na lista.
 */
export const FILTROS_RELATORIO = [
  regra('severidade', seVeio(umDeSemCaixa(SEVERIDADES)), `Severidade inválida: use ${SEVERIDADES.join(', ')}`, 'SEVERIDADE_INVALIDA'),
  regra('status', seVeio(umDeSemCaixa(STATUS_FINDING)), `Status inválido: use ${STATUS_FINDING.join(', ')}`, 'STATUS_INVALIDO'),
  regra('q', seVeio(z.string().max(BUSCA_MAXIMA)), `Busca inválida: use um texto de até ${BUSCA_MAXIMA} caracteres`, 'BUSCA_INVALIDA'),
];

/** Rotulo oficial da lista para um filtro ja validado (`alto` -> `Alto`). */
export function rotuloDaLista(lista: readonly string[], valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  return lista.find((item) => item.toLowerCase() === valor.toLowerCase());
}

/** Quem gerou o relatorio (sai no cabecalho do PDF). */
export interface AutorRelatorio {
  nome: string;
  email: string;
  perfil: string;
}

/** Linha da tabela de achados: so o que a tela de vulnerabilidades ja mostra (sem evidencia). */
export interface AchadoRelatorio {
  ativo: string;
  ativoNome: string;
  categoria: string;
  cwe: string | null;
  cve: string | null;
  cvss: number;
  cvssVetor: string | null;
  severidade: string;
  status: string;
  detectadoEm: Date;
}

/** Contagem por rotulo, na ordem oficial da lista (inclui os zeros). */
export interface Contagem {
  rotulo: string;
  total: number;
}

/** Dados do relatorio, montados antes de desenhar (testaveis sem abrir o PDF). */
export interface RelatorioVulnerabilidades {
  geradoEm: Date;
  autor: AutorRelatorio;
  filtros: FiltrosVulnerabilidade;
  resumo: {
    total: number;
    ativos: number;
    porSeveridade: Contagem[];
    porStatus: Contagem[];
    /** Media e maximo das notas CVSS (uma casa decimal); null sem achados. */
    cvssMedio: number | null;
    cvssMaximo: number | null;
  };
  /** Ordenados por CVSS, do maior para o menor (empate: o mais recente primeiro). */
  achados: AchadoRelatorio[];
}
