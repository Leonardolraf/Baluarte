import { falhar } from '../utils/resposta.js';
import { SEVERIDADES, STATUS_FINDING, STATUS_FINDING_ENCERRADO, STATUS_INICIAL_FINDING } from '../models/dominio.model.js';
import { lerRemediacao } from '../models/catalogoAchado.model.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import { faixaCvss } from './cvss.service.js';
import { registrarAuditoria } from './auditoria.service.js';
import { desenharRelatorioExcel } from './relatorioExcel.service.js';
import { desenharRelatorioPdf } from './relatorioPdf.service.js';
import { descreverFiltros, montarRelatorio, nomeDoArquivo } from './relatorioVulnerabilidade.service.js';
import * as repo from '../repositories/vulnerabilidade.repository.js';
import { buscarPorId as buscarAtivo } from '../repositories/ativo.repository.js';
import { usuariosPorIds } from '../repositories/auditoria.repository.js';
import { origemDaAutoria } from '../models/auditoria.model.js';
import {
  ACAO_EXPORTACAO_RECUSADA,
  MENSAGEM_EXPORTACAO_EM_ANDAMENTO,
  mensagemRelatorioGrande,
  TIPO_ARQUIVO,
  tetoAchadosRelatorio,
  type AlteracaoStatus,
  type AtivoFiltrado,
  type AutorRelatorio,
  type ConsultaVulnerabilidades,
  type FiltrosVulnerabilidade,
  type FindingComOrigem,
  type FindingComScan,
  type FormatoRelatorio,
  type HistoricoVulnerabilidade,
} from '../models/vulnerabilidade.model.js';

// Vulnerabilidades (achados das varreduras): lista com filtros, detalhe, mudanca de status
// e a classificacao CVSS publica do contrato.

/** "Resolvida" e "Risco aceito" saem dos KPIs, dos alertas e das listas de recentes. */
export function encerrado(f: { status: string }): boolean {
  return STATUS_FINDING_ENCERRADO.includes(f.status);
}

/** Achado como a API devolve (campos em portugues, remediacao numerada). */
export function mapFinding(f: FindingComScan) {
  return {
    id: f.id,
    ativo: f.scan.asset.host,
    ativoNome: f.scan.asset.nome,
    categoria: f.categoriaOwasp,
    cvss: f.cvss,
    cvssVetor: f.cvssVetor,
    cwe: f.cwe,
    cve: f.cve,
    severidade: f.severidade,
    status: f.status,
    descricao: f.descricao,
    evidencia: f.evidencia,
    remediacao: lerRemediacao(f.remediacao),
    // Achado de estacao (B14): o programa instalado e a base publica de onde veio o CVE.
    programa: f.programa ?? null,
    programaVersao: f.programaVersao ?? null,
    baseVulnerabilidade: f.baseVulnerabilidade ?? null,
    detectadoEm: f.criadoEm,
  };
}

/** Nota a partir da qual o achado conta como critico no KPI do dashboard (faixa CVSS 3.1). */
const NOTA_CRITICA = 9.0;

/**
 * Achados em aberto para o dashboard: contagens feitas no banco e so os `recentes` mais novos
 * (o status das varreduras avanca antes, na leitura). "Critico" e nota >= 9,0 (CVSS 3.1).
 */
export async function panoramaAbertos(recentes: number) {
  await avancarVarreduras();
  return repo.panoramaAbertos(recentes, NOTA_CRITICA);
}

/** Contagem por rotulo com todos os rotulos da lista oficial (zero incluso), na ordem dela. */
function contagemCompleta(lista: readonly string[], grupos: Array<{ rotulo: string; total: number }>) {
  const porRotulo = new Map(grupos.map((g) => [g.rotulo, g.total]));
  return Object.fromEntries(lista.map((rotulo) => [rotulo, porRotulo.get(rotulo) ?? 0]));
}

/**
 * Ativo do filtro `ativoId` (Melhorias #16), ou null sem o filtro. Ativo que nao existe e 404:
 * uma lista ou um relatorio vazio para um id errado (ou de ativo removido) diria "este ativo nao
 * tem achados", o que e falso: ausencia de dado nao e ausencia de risco.
 */
async function ativoDoFiltro(filtros: FiltrosVulnerabilidade): Promise<AtivoFiltrado | null> {
  if (!filtros.ativoId) return null;
  const ativo = await buscarAtivo(filtros.ativoId);
  if (!ativo) falhar(404, 'Ativo não encontrado', 'ATIVO_NAO_ENCONTRADO');
  return { id: ativo.id, nome: ativo.nome, host: ativo.host };
}

/**
 * Lista paginada no banco (B25): filtros e ordem viram `where`/`orderBy`, a pagina vira
 * skip/take. O `resumo` descreve o filtro inteiro (nao so a pagina): total, ativos
 * distintos e contagem por severidade e por status, mais a pagina e o tamanho usados.
 */
export async function listar(c: ConsultaVulnerabilidades) {
  await ativoDoFiltro(c.filtros);
  await avancarVarreduras();
  const r = await repo.listarPagina(c.filtros, c.ordem, c.pagina, c.tamanho);
  return {
    lista: r.findings.map(mapFinding),
    resumo: {
      total: r.total,
      ativos: r.ativos,
      pagina: c.pagina,
      tamanho: c.tamanho,
      porSeveridade: contagemCompleta(SEVERIDADES, r.porSeveridade),
      porStatus: contagemCompleta(STATUS_FINDING, r.porStatus),
    },
  };
}

/**
 * Desenho de cada formato a partir do mesmo modelo de relatorio. Exportado so para os testes
 * trocarem um desenho (`mock.method`) por um lento ou que falha (DT36: a vaga da exportacao).
 */
export const DESENHAR = { PDF: desenharRelatorioPdf, XLSX: desenharRelatorioExcel };

/**
 * Vaga unica de exportacao do relatorio (DT36). Montar e desenhar o relatorio pesa no heap e
 * trava o laco de eventos (medido em 19/10/2026: tres exportacoes simultaneas de 100 mil achados
 * derrubaram a API por falta de heap), entao so uma roda por vez; a segunda leva 429
 * EXPORTACAO_EM_ANDAMENTO. E um semaforo EM PROCESSO: vale para a API na VM, que e uma instancia
 * so. Com varias instancias (varios conteineres, ou a funcao serverless da Vercel, que abre uma
 * instancia por pedido simultaneo) cada uma tem a sua vaga, e o limite vira "uma por instancia";
 * para valer no conjunto, a vaga teria de ir para o banco (como a FileScanReserva do DT09).
 */
let exportacaoEmAndamento = false;

/** Formato e filtros de uma exportacao recusada, para o detalhe da auditoria. */
function detalheRecusa(motivo: string, filtros: FiltrosVulnerabilidade, ativo: AtivoFiltrado | null, formato: FormatoRelatorio, extra = '') {
  // Sem o ativo carregado (429, antes de ler o banco), o filtro vai pelo id: sem ele, o registro
  // pareceria de um relatorio sem filtro de ativo.
  const semAtivo = !ativo && filtros.ativoId ? `; ativoId: [${filtros.ativoId}]` : '';
  return `motivo: ${motivo}${extra}; ${descreverFiltros(filtros, ativo, true)}${semAtivo}; formato: ${formato}`;
}

/**
 * Relatorio em PDF (B24, US-011) ou Excel (Melhorias #17): TODOS os achados que a lista mostra
 * com esses filtros (o relatorio nao pagina), resumidos e ordenados por CVSS, montados uma vez
 * (`montarRelatorio`) e desenhados no formato pedido. A exportacao vai para a auditoria (com
 * quantidade, filtros e formato) depois que o arquivo ficou pronto.
 *
 * Limites (DT36), iguais no PDF e no Excel: uma exportacao por vez (429) e no maximo
 * `tetoAchadosRelatorio()` achados (422, contado com o mesmo filtro ANTES de carregar os achados).
 * As duas recusas tambem vao para a auditoria, com a acao `ACAO_EXPORTACAO_RECUSADA`.
 */
export async function exportarRelatorio(
  autor: AutorRelatorio & { id: string },
  filtros: FiltrosVulnerabilidade,
  formato: FormatoRelatorio = 'PDF',
) {
  // Conferir e ocupar a vaga sem `await` no meio: dois pedidos nunca passam juntos.
  if (exportacaoEmAndamento) {
    await registrarAuditoria(autor.id, ACAO_EXPORTACAO_RECUSADA, detalheRecusa('EXPORTACAO_EM_ANDAMENTO', filtros, null, formato));
    falhar(429, MENSAGEM_EXPORTACAO_EM_ANDAMENTO, 'EXPORTACAO_EM_ANDAMENTO');
  }
  exportacaoEmAndamento = true;
  // A vaga volta em todo desfecho: sucesso, erro de regra (404, 422), erro interno. Se o cliente
  // desistir no meio, a montagem segue ate o fim (a memoria continua ocupada) e so entao libera.
  try {
    const ativo = await ativoDoFiltro(filtros);
    await avancarVarreduras();
    const teto = tetoAchadosRelatorio();
    const recusarPorTamanho = async (total: number) => {
      await registrarAuditoria(
        autor.id,
        ACAO_EXPORTACAO_RECUSADA,
        detalheRecusa('RELATORIO_GRANDE_DEMAIS', filtros, ativo, formato, `; ${total} achados (máximo ${teto})`),
      );
      falhar(422, mensagemRelatorioGrande(total, teto), 'RELATORIO_GRANDE_DEMAIS');
    };
    const contados = await repo.contarFiltrados(filtros);
    if (contados > teto) await recusarPorTamanho(contados);
    // Teto + 1: se uma varredura terminar entre a contagem e a leitura e passar do teto, o
    // relatorio e recusado do mesmo jeito, nunca cortado (pareceria completo).
    const findings = await repo.listarFiltrados(filtros, teto + 1);
    if (findings.length > teto) await recusarPorTamanho(await repo.contarFiltrados(filtros));
    const relatorio = montarRelatorio(findings, filtros, autor, new Date(), ativo);
    const arquivo = await DESENHAR[formato](relatorio);
    const total = relatorio.resumo.total;
    await registrarAuditoria(
      autor.id,
      'EXPORTAR_RELATORIO_VULNERABILIDADES',
      `${total} ${total === 1 ? 'achado' : 'achados'}; ${descreverFiltros(filtros, ativo, true)}; formato: ${formato}`,
    );
    return {
      arquivo,
      tipo: TIPO_ARQUIVO[formato],
      nomeArquivo: nomeDoArquivo(relatorio.geradoEm, formato === 'XLSX' ? 'xlsx' : 'pdf'),
      total,
    };
  } finally {
    exportacaoEmAndamento = false;
  }
}

// ---- Historico do achado (B25b, tabela FindingStatusChange) ---------------------------

/** Acao da auditoria que registra a mudanca de status (ver `alterarStatus`). */
export const ACAO_ALTERAR_STATUS = 'ALTERAR_STATUS_VULNERABILIDADE';

/** Status com que todo achado nasce (default de Finding.status). */
export const STATUS_INICIAL = STATUS_INICIAL_FINDING;

/**
 * As mudancas explicam o status atual? Partindo de "Aberta" (o evento de criacao), cada mudanca
 * precisa sair do status em que a anterior deixou o achado, e a ultima precisa chegar no atual.
 */
export function historicoCompleto(alteracoes: Array<{ de: string; para: string }>, statusAtual: string): boolean {
  let status = STATUS_INICIAL;
  for (const a of alteracoes) {
    if (a.de !== status) return false;
    status = a.para;
  }
  return status === statusAtual;
}

/**
 * Historico do achado lido da tabela propria (B25b): o evento de criacao vira a deteccao (com a
 * varredura e o ativo de origem) e cada mudanca de status vem com autor, de e para. Os eventos
 * sao gravados na mesma transacao da mudanca (repository), e os anteriores ao B25b vieram da
 * trilha de auditoria pelo backfill da migration. `completo` sai false so quando a cadeia nao
 * explica o status atual (achado inserido por fora da API ou status mudado sem registro antes
 * da trilha), e a tela avisa em vez de inventar a sequencia.
 */
export async function historico(f: FindingComOrigem): Promise<HistoricoVulnerabilidade> {
  const registros = await repo.historicoStatus(f.id);
  const criacao = registros.find((r) => r.de === null);
  const mudancas = registros.flatMap((r) => (r.de === null ? [] : [{ ...r, de: r.de }]));
  const ids = [...new Set(mudancas.map((m) => m.usuarioId).filter((id): id is string => id !== null))];
  const autores = new Map((ids.length ? await usuariosPorIds(ids) : []).map((u) => [u.id, { id: u.id, nome: u.nome }]));
  const alteracoes: AlteracaoStatus[] = mudancas.map((m) => {
    const autor = (m.usuarioId ? autores.get(m.usuarioId) : undefined) ?? null;
    // Mesma regra de autoria da consulta da auditoria (#22): sem usuario = automatico.
    return { quando: m.registradaEm, de: m.de, para: m.para, autor, automatico: origemDaAutoria(m.usuarioId, autor !== null) === 'automatico' };
  });
  return {
    eventos: [
      {
        tipo: 'DETECTADO',
        // Sem evento de criacao (achado inserido por fora da API), a data e a do proprio achado.
        quando: criacao?.registradaEm ?? f.criadoEm,
        varreduraId: f.scan.id,
        ativo: f.scan.asset.host,
        ativoNome: f.scan.asset.nome,
      },
      ...alteracoes.map((a) => ({ tipo: 'STATUS_ALTERADO' as const, ...a })),
    ],
    statusAtual: f.status,
    completo: historicoCompleto(alteracoes, f.status),
  };
}

/** Detalhe: o achado, a origem (varredura e ativo) e o historico. */
async function detalheCompleto(f: FindingComOrigem) {
  return {
    ...mapFinding(f),
    origem: {
      varreduraId: f.scan.id,
      varreduraIniciadaEm: f.scan.criadoEm,
      varreduraConcluidaEm: f.scan.concluidoEm,
      ativoId: f.scan.asset.id,
    },
    historico: await historico(f),
  };
}

export async function detalhe(id: string) {
  const f = await repo.buscar(id);
  if (!f) falhar(404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
  return detalheCompleto(f);
}

export async function alterarStatus(atorId: string, id: string, status: string) {
  // O evento do historico (B25b) e gravado na mesma transacao que muda o status (repository).
  const r = await repo.alterarStatus(id, status, atorId);
  if (!r) falhar(404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
  // RN-008: so registra mudanca de fato (repetir o mesmo status nao e evento).
  // O backfill da migration historico_status_achado leu este formato da trilha; o historico
  // agora vem da tabela, entao o texto pode mudar sem afetar a aba de historico.
  if (r.anterior !== status)
    await registrarAuditoria(
      atorId,
      ACAO_ALTERAR_STATUS,
      `${id} (${r.finding.scan.asset.host}, ${r.finding.categoriaOwasp}): ${r.anterior} → ${status}`,
    );
  // Devolve o detalhe (o historico ja conta esta mudanca), como GET /vulnerabilidades/:id.
  return detalheCompleto(r.finding);
}

/** Classificacao publica do contrato: faixa de severidade de uma nota CVSS. */
export function classificar(cvss: number) {
  return { cvss, faixa: faixaCvss(cvss) };
}
