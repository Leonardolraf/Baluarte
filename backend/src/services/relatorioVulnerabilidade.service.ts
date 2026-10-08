import { SEVERIDADES, STATUS_FINDING } from '../models/dominio.model.js';
import {
  FUSO_RELATORIO,
  type AutorRelatorio,
  type Contagem,
  type FiltrosVulnerabilidade,
  type FindingComScan,
  type RelatorioVulnerabilidades,
} from '../models/vulnerabilidade.model.js';

// Relatorio de vulnerabilidades (B24, US-011): monta os dados do relatorio a partir dos
// achados ja filtrados. Nao fala com o banco nem desenha nada — o PDF sai de
// `relatorioPdf.service.ts` a partir deste modelo, e o orquestrador e
// `vulnerabilidade.service.ts#exportarRelatorio`.

/** Uma casa decimal, como a nota CVSS aparece na tela. */
function umaCasa(valor: number): number {
  return Math.round(valor * 10) / 10;
}

function contar(rotulos: readonly string[], valores: string[]): Contagem[] {
  return rotulos.map((rotulo) => ({ rotulo, total: valores.filter((v) => v === rotulo).length }));
}

/**
 * Modelo do relatorio: resumo (total, ativos, por severidade, por status, CVSS medio e
 * maximo) e achados ordenados por CVSS desc. Recebe os achados JA filtrados; `filtros` so
 * vai para o cabecalho.
 */
export function montarRelatorio(
  findings: FindingComScan[],
  filtros: FiltrosVulnerabilidade,
  autor: AutorRelatorio,
  geradoEm: Date = new Date(),
): RelatorioVulnerabilidades {
  const achados = findings
    .map((f) => ({
      ativo: f.scan.asset.host,
      ativoNome: f.scan.asset.nome,
      categoria: f.categoriaOwasp,
      cwe: f.cwe,
      cve: f.cve,
      cvss: f.cvss,
      cvssVetor: f.cvssVetor,
      severidade: f.severidade,
      status: f.status,
      detectadoEm: f.criadoEm,
      programa: f.programa ?? null,
      programaVersao: f.programaVersao ?? null,
    }))
    .sort((a, b) => b.cvss - a.cvss || b.detectadoEm.getTime() - a.detectadoEm.getTime());
  const notas = achados.map((a) => a.cvss);
  return {
    geradoEm,
    autor: { nome: autor.nome, email: autor.email, perfil: autor.perfil },
    filtros: { ...filtros },
    resumo: {
      total: achados.length,
      ativos: new Set(achados.map((a) => a.ativo)).size,
      porSeveridade: contar(SEVERIDADES, achados.map((a) => a.severidade)),
      porStatus: contar(STATUS_FINDING, achados.map((a) => a.status)),
      cvssMedio: notas.length ? umaCasa(notas.reduce((s, n) => s + n, 0) / notas.length) : null,
      cvssMaximo: notas.length ? umaCasa(Math.max(...notas)) : null,
    },
    achados,
  };
}

/** Filtros em texto, para o cabecalho do PDF e o detalhe da auditoria. */
export function descreverFiltros(f: FiltrosVulnerabilidade): string {
  return `severidade: ${f.severidade ?? 'todas'}; status: ${f.status ?? 'todos'}; busca: ${f.q ? `"${f.q}"` : 'nenhuma'}`;
}

/** Partes da data no fuso do relatorio (o servidor da Vercel roda em UTC). */
function partes(data: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO_RELATORIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(data).map((p) => [p.type, p.value]));
}

/** `08/10/2026`. */
export function dataCurta(data: Date): string {
  const p = partes(data);
  return `${p.day}/${p.month}/${p.year}`;
}

/** `08/10/2026 14:32`. */
export function dataHora(data: Date): string {
  const p = partes(data);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** `baluarte-vulnerabilidades-AAAA-MM-DD.pdf`, com a data de geracao no fuso do relatorio. */
export function nomeDoArquivo(geradoEm: Date): string {
  const p = partes(geradoEm);
  return `baluarte-vulnerabilidades-${p.year}-${p.month}-${p.day}.pdf`;
}
