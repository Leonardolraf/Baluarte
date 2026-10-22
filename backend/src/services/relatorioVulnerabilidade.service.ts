import { SEVERIDADES, STATUS_FINDING } from '../models/dominio.model.js';
import {
  FUSO_RELATORIO,
  type AtivoFiltrado,
  type AutorRelatorio,
  type Contagem,
  type FiltrosVulnerabilidade,
  type FindingComScan,
  type RelatorioVulnerabilidades,
} from '../models/vulnerabilidade.model.js';

// Relatorio de vulnerabilidades (B24, US-011): monta os dados do relatorio a partir dos
// achados ja filtrados. Nao fala com o banco nem desenha nada — o PDF sai de
// `relatorioPdf.service.ts` e a planilha de `relatorioExcel.service.ts` (Melhorias #17), os
// dois a partir deste modelo; o orquestrador e `vulnerabilidade.service.ts#exportarRelatorio`.

/** Uma casa decimal, como a nota CVSS aparece na tela. */
function umaCasa(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/**
 * Maior valor da lista, num laco (DT36). `Math.max(...lista)` passa cada item como argumento e
 * estoura a pilha do V8 acima de ~123 mil itens (RangeError, medido em 19/10/2026 pela rota do
 * relatorio): o PDF e o Excel caiam em 500. Lista vazia devolve null.
 */
export function maximo(valores: readonly number[]): number | null {
  let maior: number | null = null;
  for (const v of valores) if (maior === null || v > maior) maior = v;
  return maior;
}

function contar(rotulos: readonly string[], valores: string[]): Contagem[] {
  return rotulos.map((rotulo) => ({ rotulo, total: valores.filter((v) => v === rotulo).length }));
}

/**
 * Modelo do relatorio: resumo (total, ativos, por severidade, por status, CVSS medio e
 * maximo) e achados ordenados por CVSS desc. Recebe os achados JA filtrados; `filtros` e
 * `ativo` (o ativo do filtro `ativoId`, com nome e host) so vao para o cabecalho.
 */
export function montarRelatorio(
  findings: FindingComScan[],
  filtros: FiltrosVulnerabilidade,
  autor: AutorRelatorio,
  geradoEm: Date = new Date(),
  ativo: AtivoFiltrado | null = null,
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
  const notaMaxima = maximo(notas);
  return {
    geradoEm,
    autor: { nome: autor.nome, email: autor.email, perfil: autor.perfil },
    filtros: { ...filtros },
    ativo: ativo ? { id: ativo.id, nome: ativo.nome, host: ativo.host } : null,
    resumo: {
      total: achados.length,
      ativos: new Set(achados.map((a) => a.ativo)).size,
      porSeveridade: contar(SEVERIDADES, achados.map((a) => a.severidade)),
      porStatus: contar(STATUS_FINDING, achados.map((a) => a.status)),
      cvssMedio: notas.length ? umaCasa(notas.reduce((s, n) => s + n, 0) / notas.length) : null,
      cvssMaximo: notaMaxima === null ? null : umaCasa(notaMaxima),
    },
    achados,
  };
}

/**
 * Filtros em texto, para o cabecalho do relatorio e o detalhe da auditoria. O ativo so aparece
 * quando o filtro `ativoId` veio, pelo nome e host (dizem mais que o id). Com `comId` (auditoria),
 * o id vai entre colchetes, para o registro apontar o ativo mesmo se ele for renomeado depois.
 */
export function descreverFiltros(f: FiltrosVulnerabilidade, ativo: AtivoFiltrado | null = null, comId = false): string {
  const base = `severidade: ${f.severidade ?? 'todas'}; status: ${f.status ?? 'todos'}; busca: ${f.q ? `"${f.q}"` : 'nenhuma'}`;
  return ativo ? `${base}; ativo: ${ativo.nome} (${ativo.host})${comId ? ` [${ativo.id}]` : ''}` : base;
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
    second: '2-digit',
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

/**
 * A mesma data e hora "de parede" do fuso do relatorio, escrita como UTC. A planilha nao tem
 * fuso: o Excel mostra a data como foi gravada, e o exceljs grava o instante em UTC. Sem isso,
 * um achado das 21h de Brasilia apareceria no dia seguinte, a meia-noite.
 */
export function horaLocalComoUtc(data: Date): Date {
  const p = partes(data);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second, data.getUTCMilliseconds()));
}

/** `baluarte-vulnerabilidades-AAAA-MM-DD.pdf` (ou `.xlsx`), com a data de geracao no fuso do relatorio. */
export function nomeDoArquivo(geradoEm: Date, extensao: 'pdf' | 'xlsx' = 'pdf'): string {
  const p = partes(geradoEm);
  return `baluarte-vulnerabilidades-${p.year}-${p.month}-${p.day}.${extensao}`;
}
