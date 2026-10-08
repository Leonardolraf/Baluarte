import type { Finding } from '@prisma/client';
import { z } from 'zod';
import { notaCvss, regra, regrasDePaginacao, seVeio, umDe, umDeSemCaixa } from '../utils/esquemas.js';
import { SEVERIDADES, STATUS_FINDING } from './dominio.model.js';

// Model de vulnerabilidade (achado de varredura): tipos do dominio, DTOs e regras de entrada (zod).

/** Achado como esta no banco (tabela Finding). */
export type Vulnerabilidade = Finding;

/** Achado com a varredura e o ativo (o ativo e identificado pelo host na API). */
export type FindingComScan = {
  id: string; categoriaOwasp: string; cvss: number; severidade: string; descricao: string; evidencia: string;
  cwe: string | null; cve: string | null; cvssVetor: string | null; remediacao: unknown; status: string; criadoEm: Date;
  /** Achado de estacao (B14): programa com CVE conhecido; nulos nos achados do scanner. */
  programa?: string | null; programaVersao?: string | null; baseVulnerabilidade?: string | null;
  scan: { asset: { host: string; nome: string } };
};

/** Achado com a origem completa (varredura e ativo com id): o detalhe mostra de onde ele veio. */
export type FindingComOrigem = FindingComScan & {
  scan: { id: string; criadoEm: Date; concluidoEm: Date | null; asset: { id: string; host: string; nome: string } };
};

/**
 * Filtros da lista e do relatorio, ja validados e no rotulo oficial (`alto` -> `Alto`):
 * severidade e status sao comparados por igualdade; `q` busca no host, na categoria, no CVE ou no programa (B14).
 */
export interface FiltrosVulnerabilidade {
  severidade?: string;
  status?: string;
  q?: string;
}

/** Campos pelos quais a lista pode ser ordenada (GET /vulnerabilidades?ordenar=). */
export const CAMPOS_ORDENACAO = ['detectadoEm', 'cvss', 'descricao'] as const;
export type CampoOrdenacao = (typeof CAMPOS_ORDENACAO)[number];
export const DIRECOES = ['asc', 'desc'] as const;
export type Direcao = (typeof DIRECOES)[number];

/** Ordem da lista. Sem `ordenar`, a mais recente primeiro (como era antes da paginacao). */
export interface OrdemVulnerabilidade {
  campo: CampoOrdenacao;
  direcao: Direcao;
}
export const ORDEM_PADRAO: OrdemVulnerabilidade = { campo: 'detectadoEm', direcao: 'desc' };

/** Tamanho padrao e maximo da pagina da lista (os mesmos da auditoria). */
export const TAMANHO_PADRAO = 20;
export const TAMANHO_MAXIMO = 100;

/** Consulta da lista paginada (filtros + ordem + pagina). */
export interface ConsultaVulnerabilidades {
  filtros: FiltrosVulnerabilidade;
  ordem: OrdemVulnerabilidade;
  pagina: number;
  tamanho: number;
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

/**
 * Regras da query de GET /vulnerabilidades: os filtros do relatorio (mesmos codigos), a
 * paginacao (`pagina`, `tamanho` <= 100) e a ordenacao. Valor desconhecido, repetido ou
 * objeto/array dá 400 com codigo proprio, nunca uma lista que parece filtrada sem estar.
 */
export const CONSULTA_LISTA = [
  ...FILTROS_RELATORIO,
  ...regrasDePaginacao(TAMANHO_MAXIMO),
  regra('ordenar', seVeio(umDe(CAMPOS_ORDENACAO)), `Ordenação inválida: use ${CAMPOS_ORDENACAO.join(', ')}`, 'ORDENACAO_INVALIDA'),
  regra('direcao', seVeio(umDe(DIRECOES)), 'Direção inválida: use asc ou desc', 'DIRECAO_INVALIDA'),
];

/** Rotulo oficial da lista para um filtro ja validado (`alto` -> `Alto`). */
export function rotuloDaLista(lista: readonly string[], valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  return lista.find((item) => item.toLowerCase() === valor.toLowerCase());
}

// ---- Historico do achado (B25b, tabela FindingStatusChange) ---------------------

/** Mudanca de status registrada no historico do achado. */
export interface AlteracaoStatus {
  quando: Date;
  de: string;
  para: string;
  autor: { id: string; nome: string } | null;
}

/**
 * Historico como a API devolve: a deteccao (evento de criacao) e as mudancas de status da tabela
 * FindingStatusChange. `completo` diz se essas mudancas explicam o status atual a partir de
 * "Aberta" (o status com que todo achado nasce); quando nao explicam (achado inserido por fora
 * da API, ou status mudado sem registro antes da trilha de auditoria), a tela avisa.
 */
export interface HistoricoVulnerabilidade {
  eventos: Array<
    | { tipo: 'DETECTADO'; quando: Date; varreduraId: string; ativo: string; ativoNome: string }
    | ({ tipo: 'STATUS_ALTERADO' } & AlteracaoStatus)
  >;
  statusAtual: string;
  completo: boolean;
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
  /** Achado de estacao (B14): programa e versao instalados; null nos achados do scanner. */
  programa: string | null;
  programaVersao: string | null;
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
