import type { Finding } from '@prisma/client';
import { z } from 'zod';
import { idRecurso, notaCvss, regra, regrasDePaginacao, seVeio, umDe, umDeSemCaixa } from '../utils/esquemas.js';
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
 * severidade e status sao comparados por igualdade; `q` busca no host, na categoria, no CVE ou no programa (B14);
 * `ativoId` restringe aos achados das varreduras de um ativo (Melhorias #16).
 */
export interface FiltrosVulnerabilidade {
  severidade?: string;
  status?: string;
  q?: string;
  ativoId?: string;
}

/** Ativo do filtro `ativoId`, como sai no cabecalho do relatorio e no detalhe da auditoria. */
export interface AtivoFiltrado {
  id: string;
  nome: string;
  host: string;
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

// ---- Relatorio em PDF (B24, US-011) e em Excel (Melhorias #17) --------------------

/** Formatos de exportacao do relatorio (o mesmo modelo, dois desenhos). */
export const FORMATOS_RELATORIO = ['PDF', 'XLSX'] as const;
export type FormatoRelatorio = (typeof FORMATOS_RELATORIO)[number];

/** Tipo MIME de cada formato (vai no Content-Type do download). */
export const TIPO_ARQUIVO: Record<FormatoRelatorio, string> = {
  PDF: 'application/pdf',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Fuso das datas do relatorio (data/hora de geracao, nome do arquivo e data dos achados). */
export const FUSO_RELATORIO = 'America/Sao_Paulo';

/** Tamanho maximo da busca livre aceita no relatorio. */
export const BUSCA_MAXIMA = 100;

/**
 * Teto de achados por exportacao do relatorio, PDF ou Excel (DT36). O relatorio e montado
 * inteiro em memoria (os achados do Prisma, o modelo e o desenho do exceljs/pdfkit) e o desenho
 * e sincrono. Medido em 19/10/2026 na imagem da API (Node 20, heap padrao de 2.096 MB com os
 * 7,8 GiB da VM), pela rota do xlsx: 50 mil achados levam ~18 s, com RSS de ~1,1 GB e heap de
 * ~0,9 GB; 100 mil levam ~36 s, com RSS de 2,1 GB, e travam o laco de eventos (o /health chegou
 * a 23,8 s); 200 mil estouram o heap e derrubam o processo para todo mundo. Com 50 mil sobra
 * heap para o resto da API durante a exportacao, e o bloqueio do laco fica na casa de 10 s.
 * Acima do teto: 422 RELATORIO_GRANDE_DEMAIS com o total, nunca um relatorio cortado (que
 * pareceria completo: ausencia de dado nao e ausencia de risco).
 */
export const TETO_ACHADOS_RELATORIO = 50_000;

/**
 * Teto em vigor. `RELATORIO_TETO_ACHADOS` so pode BAIXAR o teto (os testes usam um teto pequeno
 * para nao semear 50 mil achados a cada teste); valor maior que a constante, vazio ou invalido
 * fica na constante, entao o ambiente nunca afrouxa o limite de producao.
 */
export function tetoAchadosRelatorio(): number {
  const valor = Number(process.env.RELATORIO_TETO_ACHADOS);
  return Number.isInteger(valor) && valor > 0 ? Math.min(valor, TETO_ACHADOS_RELATORIO) : TETO_ACHADOS_RELATORIO;
}

const MILHAR = new Intl.NumberFormat('pt-BR');

/** Mensagem do 422: diz quanto deu, qual o maximo e o que fazer (filtrar). */
export function mensagemRelatorioGrande(total: number, teto: number): string {
  return `O relatório teria ${MILHAR.format(total)} achados (máximo ${MILHAR.format(teto)}). Filtre por severidade, status ou ativo para gerar um relatório menor.`;
}

/** Mensagem do 429: outra exportacao ocupa a vaga (uma por vez no processo). */
export const MENSAGEM_EXPORTACAO_EM_ANDAMENTO =
  'Já há uma exportação de relatório em andamento. Tente de novo em instantes.';

/**
 * Exportacao recusada (DT36) vai para a auditoria com acao propria, nao com a de sucesso: a
 * `EXPORTAR_RELATORIO_VULNERABILIDADES` quer dizer "um arquivo com N achados saiu do sistema", e
 * quem filtra a trilha por ela (a tela de auditoria, os testes) contaria recusas como
 * exportacoes. O motivo (o codigo da resposta) vai no detalhe, com os filtros e o formato.
 */
export const ACAO_EXPORTACAO_RECUSADA = 'EXPORTAR_RELATORIO_VULNERABILIDADES_RECUSADA';

/**
 * Regras da query de GET /vulnerabilidades/relatorio.pdf e .xlsx (e da lista): os filtros
 * validados (valor desconhecido, repetido ou objeto/array dá 400, para nunca entregar um
 * relatorio que parece filtrado sem estar). Maiusculas nao importam na severidade e no status.
 * `ativoId` (Melhorias #16) segue o formato de id de recurso (cuid ou id do seed); ativo que
 * nao existe e 404 no service, nunca uma lista vazia que pareceria "ativo sem achados".
 */
export const FILTROS_RELATORIO = [
  regra('severidade', seVeio(umDeSemCaixa(SEVERIDADES)), `Severidade inválida: use ${SEVERIDADES.join(', ')}`, 'SEVERIDADE_INVALIDA'),
  regra('status', seVeio(umDeSemCaixa(STATUS_FINDING)), `Status inválido: use ${STATUS_FINDING.join(', ')}`, 'STATUS_INVALIDO'),
  regra('q', seVeio(z.string().max(BUSCA_MAXIMA)), `Busca inválida: use um texto de até ${BUSCA_MAXIMA} caracteres`, 'BUSCA_INVALIDA'),
  regra('ativoId', seVeio(idRecurso), 'Identificador de ativo inválido', 'ATIVO_ID_INVALIDO'),
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
  /**
   * Mudança feita pelo próprio sistema (evento gravado sem usuário, como o fechamento automático
   * do B36). Separa "pelo Baluarte" de autor `null` por conta excluída, que a tela mostra diferente.
   */
  automatico: boolean;
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
  /** Ativo do filtro `ativoId` (nome e host para o cabecalho); null sem esse filtro. */
  ativo: AtivoFiltrado | null;
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
