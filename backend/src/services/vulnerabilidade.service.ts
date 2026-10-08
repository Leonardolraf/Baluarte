import { falhar } from '../utils/resposta.js';
import { SEVERIDADES, STATUS_FINDING, STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import { lerRemediacao } from '../models/catalogoAchado.model.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import { faixaCvss } from './cvss.service.js';
import { registrarAuditoria } from './auditoria.service.js';
import { desenharRelatorioPdf } from './relatorioPdf.service.js';
import { descreverFiltros, montarRelatorio, nomeDoArquivo } from './relatorioVulnerabilidade.service.js';
import * as repo from '../repositories/vulnerabilidade.repository.js';
import { alteracoesDeStatus, usuariosPorIds } from '../repositories/auditoria.repository.js';
import type {
  AlteracaoStatus,
  AutorRelatorio,
  ConsultaVulnerabilidades,
  FiltrosVulnerabilidade,
  FindingComOrigem,
  FindingComScan,
  HistoricoVulnerabilidade,
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

/** Todos os achados (o status das varreduras avanca antes, na leitura). */
export async function todos(): Promise<FindingComScan[]> {
  await avancarVarreduras();
  return repo.listar();
}

/** Contagem por rotulo com todos os rotulos da lista oficial (zero incluso), na ordem dela. */
function contagemCompleta(lista: readonly string[], grupos: Array<{ rotulo: string; total: number }>) {
  const porRotulo = new Map(grupos.map((g) => [g.rotulo, g.total]));
  return Object.fromEntries(lista.map((rotulo) => [rotulo, porRotulo.get(rotulo) ?? 0]));
}

/**
 * Lista paginada no banco (B25): filtros e ordem viram `where`/`orderBy`, a pagina vira
 * skip/take. O `resumo` descreve o filtro inteiro (nao so a pagina): total, ativos
 * distintos e contagem por severidade e por status, mais a pagina e o tamanho usados.
 */
export async function listar(c: ConsultaVulnerabilidades) {
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
 * Relatorio em PDF (B24, US-011): TODOS os achados que a lista mostra com esses filtros (o
 * relatorio nao pagina), resumidos e ordenados por CVSS. A exportacao vai para a auditoria
 * (com filtros e quantidade) depois que o PDF ficou pronto.
 */
export async function exportarRelatorio(autor: AutorRelatorio & { id: string }, filtros: FiltrosVulnerabilidade) {
  await avancarVarreduras();
  const relatorio = montarRelatorio(await repo.listarFiltrados(filtros), filtros, autor);
  const pdf = await desenharRelatorioPdf(relatorio);
  const total = relatorio.resumo.total;
  await registrarAuditoria(
    autor.id,
    'EXPORTAR_RELATORIO_VULNERABILIDADES',
    `${total} ${total === 1 ? 'achado' : 'achados'}; ${descreverFiltros(filtros)}`,
  );
  return { pdf, nomeArquivo: nomeDoArquivo(relatorio.geradoEm), total };
}

// ---- Historico do achado (B25, sem tabela propria) -------------------------------

/** Acao da auditoria que registra a mudanca de status (ver `alterarStatus`). */
export const ACAO_ALTERAR_STATUS = 'ALTERAR_STATUS_VULNERABILIDADE';

/** Status com que o scanner cria todo achado (default da coluna Finding.status). */
export const STATUS_INICIAL = 'Aberta';

/**
 * Le "de -> para" de um registro ALTERAR_STATUS_VULNERABILIDADE. O detalhe e gravado por
 * `alterarStatus` como `<id> (<host>, <categoria>): <de> → <para>`; a categoria tem ":" (ex.:
 * "A03:2021 - Injection"), por isso o par e lido do FIM, e so vale com status da lista oficial.
 * Detalhe de outro achado ou fora do formato devolve null (o registro e ignorado).
 */
export function lerAlteracaoStatus(detalhe: string | null, findingId: string): { de: string; para: string } | null {
  if (!detalhe || !detalhe.startsWith(`${findingId} (`)) return null;
  const separador = detalhe.lastIndexOf(': ');
  if (separador < 0) return null;
  const [de, para, ...resto] = detalhe.slice(separador + 2).split(' → ');
  if (resto.length || !STATUS_FINDING.includes(de) || !STATUS_FINDING.includes(para)) return null;
  return { de, para };
}

/**
 * As mudancas explicam o status atual? Partindo de "Aberta", cada mudanca precisa sair do
 * status em que a anterior deixou o achado, e a ultima precisa chegar no status atual.
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
 * Historico honesto do achado: so o que o dado sustenta. A deteccao vem do proprio achado
 * (data e a varredura que o gerou); as mudancas de status vem da trilha de auditoria. Nao ha
 * tabela de historico (pendencia B25b): quando a trilha nao explica o status atual,
 * `completo` sai false e a tela avisa, em vez de inventar a sequencia.
 */
export async function historico(f: FindingComOrigem): Promise<HistoricoVulnerabilidade> {
  const registros = await alteracoesDeStatus(ACAO_ALTERAR_STATUS, f.id);
  const lidos = registros.flatMap((r) => {
    const mudanca = lerAlteracaoStatus(r.detalhe, f.id);
    return mudanca ? [{ quando: r.timestamp, usuarioId: r.usuarioId, ...mudanca }] : [];
  });
  const ids = [...new Set(lidos.map((x) => x.usuarioId).filter((id): id is string => id !== null))];
  const autores = new Map((ids.length ? await usuariosPorIds(ids) : []).map((u) => [u.id, { id: u.id, nome: u.nome }]));
  const alteracoes: AlteracaoStatus[] = lidos.map(({ usuarioId, ...a }) => ({
    ...a,
    autor: (usuarioId ? autores.get(usuarioId) : undefined) ?? null,
  }));
  return {
    eventos: [
      { tipo: 'DETECTADO', quando: f.criadoEm, varreduraId: f.scan.id, ativo: f.scan.asset.host, ativoNome: f.scan.asset.nome },
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
  const atual = await repo.existe(id);
  if (!atual) falhar(404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
  const f = await repo.alterarStatus(id, status);
  // RN-008: so registra mudanca de fato (repetir o mesmo status nao e evento).
  // O historico do detalhe le este formato (`lerAlteracaoStatus`): mudar aqui exige mudar la.
  if (atual.status !== status)
    await registrarAuditoria(atorId, ACAO_ALTERAR_STATUS, `${id} (${f.scan.asset.host}, ${f.categoriaOwasp}): ${atual.status} → ${status}`);
  // Devolve o detalhe (o historico ja conta esta mudanca), como GET /vulnerabilidades/:id.
  return detalheCompleto(f);
}

/** Classificacao publica do contrato: faixa de severidade de uma nota CVSS. */
export function classificar(cvss: number) {
  return { cvss, faixa: faixaCvss(cvss) };
}
