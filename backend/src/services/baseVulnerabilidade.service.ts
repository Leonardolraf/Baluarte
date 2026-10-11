import { BaseIndisponivel } from '../config/baseExterna.js';
import * as nvd from '../config/nvd.js';
import * as osv from '../config/osv.js';
import {
  CONCORRENCIA_OSV,
  LIMITE_DETALHES_OSV,
  LIMITE_NVD_COM_CHAVE,
  LIMITE_NVD_SEM_CHAVE,
  LOTE_OSV,
  contagemNvd,
  lerCvesNvd,
  lerLoteOsv,
  lerVulnOsv,
  validadeCacheHoras,
  type BaseVulnerabilidade,
  type CveNvd,
  type VulnOsv,
} from '../models/cruzamento.model.js';
import * as cache from '../repositories/baseVulnerabilidade.repository.js';

// Consultas ao OSV e ao NVD com cache no banco (B14). Cada verificacao abre uma SessaoConsulta,
// que guarda o orcamento de requisicoes e as bases que falharam. Regra de falha: base fora do
// ar, lenta ou com resposta estranha vira log + "falha" na sessao, nunca excecao para quem
// chamou e nunca achado (o que nao foi confirmado fica para a proxima verificacao). So resposta
// valida vai para o cache, inclusive a vazia ("nenhuma vulnerabilidade" tambem e resposta).

export class SessaoConsulta {
  readonly falhas = new Set<BaseVulnerabilidade>();
  /** Consultas que nao couberam no orcamento desta verificacao. */
  pendentes = 0;
  detalhesOsvRestantes = LIMITE_DETALHES_OSV;
  nvdRestantes = nvd.temChave() ? LIMITE_NVD_COM_CHAVE : LIMITE_NVD_SEM_CHAVE;

  falhou(base: BaseVulnerabilidade, e: unknown): void {
    if (!(e instanceof BaseIndisponivel)) throw e;
    if (!this.falhas.has(base)) console.error(`[cruzamento] ${e.message}; a verificação segue sem essa base`);
    this.falhas.add(base);
  }
}

const validadeMs = () => validadeCacheHoras() * 3600_000;

export const chaveConsultaOsv = (c: osv.ConsultaPacote) => `consulta:${c.ecossistema}|${c.nome}|${c.versao}`;

async function emParalelo<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabalhador = async () => {
    while (i < itens.length) await fn(itens[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
}

/**
 * Ids das vulnerabilidades do OSV que afetam cada pacote (querybatch, em lotes). Devolve
 * chave da consulta -> ids; consulta ausente no mapa = nao respondida (falha do OSV).
 */
export async function idsOsv(consultas: osv.ConsultaPacote[], s: SessaoConsulta): Promise<Map<string, string[]>> {
  const unicas = [...new Map(consultas.map((c) => [chaveConsultaOsv(c), c])).values()];
  const emCache = await cache.lerValidas('OSV', unicas.map(chaveConsultaOsv));
  const resultado = new Map<string, string[]>();
  for (const [chave, dados] of emCache) resultado.set(chave, (dados as { ids?: string[] }).ids ?? []);
  const faltam = unicas.filter((c) => !resultado.has(chaveConsultaOsv(c)));
  for (let i = 0; i < faltam.length && !s.falhas.has('OSV'); i += LOTE_OSV) {
    const lote = faltam.slice(i, i + LOTE_OSV);
    try {
      const ids = lerLoteOsv(await osv.consultarLote(lote), lote.length);
      if (!ids) throw new BaseIndisponivel('OSV', 'resposta do querybatch fora do formato');
      const entradas = lote.map((c, j) => ({ chave: chaveConsultaOsv(c), dados: { ids: ids[j] } }));
      await cache.gravar('OSV', entradas, validadeMs());
      for (const e of entradas) resultado.set(e.chave, e.dados.ids);
    } catch (e) {
      s.falhou('OSV', e);
    }
  }
  return resultado;
}

/**
 * Registros completos do OSV. id -> VulnOsv, ou null quando o OSV nao conhece o id (ou o
 * registro veio fora do formato). Id ausente no mapa = nao consultado (falha ou orcamento).
 */
export async function vulnsOsv(ids: string[], s: SessaoConsulta): Promise<Map<string, VulnOsv | null>> {
  const unicos = [...new Set(ids)];
  const resultado = new Map<string, VulnOsv | null>();
  const emCache = await cache.lerValidas('OSV', unicos.map((id) => `vuln:${id}`));
  for (const [chave, dados] of emCache) resultado.set(chave.slice('vuln:'.length), (dados as { vuln: VulnOsv | null }).vuln ?? null);
  let faltam = unicos.filter((id) => !resultado.has(id));
  if (s.falhas.has('OSV')) faltam = [];
  if (faltam.length > s.detalhesOsvRestantes) {
    s.pendentes += faltam.length - s.detalhesOsvRestantes;
    faltam = faltam.slice(0, s.detalhesOsvRestantes);
  }
  s.detalhesOsvRestantes -= faltam.length;
  const novas: { chave: string; dados: { vuln: VulnOsv | null } }[] = [];
  await emParalelo(faltam, CONCORRENCIA_OSV, async (id) => {
    if (s.falhas.has('OSV')) return;
    try {
      const json = await osv.buscarVulnerabilidade(id);
      const vuln = json === null ? null : lerVulnOsv(json);
      if (json !== null && !vuln) console.error(`[cruzamento] OSV: registro ${id} fora do formato; ignorado`);
      resultado.set(id, vuln);
      novas.push({ chave: `vuln:${id}`, dados: { vuln } });
    } catch (e) {
      s.falhou('OSV', e);
    }
  });
  await cache.gravar('OSV', novas, validadeMs());
  return resultado;
}

/** Reserva uma consulta ao NVD no orcamento; false (e conta como pendente) se nao ha mais. */
function reservarNvd(s: SessaoConsulta): boolean {
  if (s.falhas.has('NVD')) return false;
  if (s.nvdRestantes <= 0) {
    s.pendentes += 1;
    return false;
  }
  s.nvdRestantes -= 1;
  return true;
}

/** Versao do formato da entrada de cache por CPE (2 = correcoes com plataformas, DT21). */
const FORMATO_CACHE_CPE = 2;

/** CVEs do NVD para um CPE; undefined = nao consultado (falha ou orcamento). */
export async function cvesPorCpe(cpe: string, s: SessaoConsulta): Promise<CveNvd[] | undefined> {
  const chave = `cpe:${cpe}`;
  const emCache = (await cache.lerValidas('NVD', [chave])).get(chave);
  const entrada = emCache as { cves?: CveNvd[]; formato?: number } | undefined;
  // Entrada gravada antes do formato atual nao serve: sem `correcoes` (DT17) todo CVE pareceria
  // sem correcao, e sem `plataformas` (DT21) o "Chrome no Android" contaria no Windows. Consulta
  // de novo e regrava.
  if (entrada && entrada.formato === FORMATO_CACHE_CPE) return entrada.cves ?? [];
  // Pagina pelo startIndex ate receber os totalResults (antes so vinha a primeira pagina, e o que
  // passava de 2000 sumia sem aviso). Cada pagina conta no orcamento; se ele acabar no meio, a
  // consulta fica pendente e nada parcial vai para o cache: a proxima verificacao recomeca.
  const cves: CveNvd[] = [];
  let inicio = 0;
  for (;;) {
    if (!reservarNvd(s)) return undefined;
    try {
      const json = await nvd.cvesPorCpe(cpe, inicio);
      if (json === null) break; // 404: CPE fora do dicionario, nenhum CVE
      const pagina = lerCvesNvd(json);
      const contagem = contagemNvd(json);
      if (!pagina || !contagem) throw new BaseIndisponivel('NVD', 'resposta fora do formato');
      cves.push(...pagina);
      inicio += contagem.naPagina;
      if (contagem.naPagina === 0 || inicio >= contagem.total) {
        if (inicio < contagem.total) throw new BaseIndisponivel('NVD', `página vazia antes do fim (${inicio} de ${contagem.total})`);
        break;
      }
    } catch (e) {
      s.falhou('NVD', e);
      return undefined;
    }
  }
  try {
    await cache.gravar('NVD', [{ chave, dados: { cves, formato: FORMATO_CACHE_CPE } }], validadeMs());
  } catch (e) {
    s.falhou('NVD', e);
    return undefined;
  }
  return cves;
}

/** Um CVE do NVD; null = o NVD nao o tem; undefined = nao consultado (falha ou orcamento). */
export async function cvePorId(cve: string, s: SessaoConsulta): Promise<CveNvd | null | undefined> {
  const chave = `cve:${cve}`;
  const emCache = (await cache.lerValidas('NVD', [chave])).get(chave);
  if (emCache) return (emCache as { cve?: CveNvd | null }).cve ?? null;
  if (!reservarNvd(s)) return undefined;
  try {
    const json = await nvd.cvePorId(cve);
    const lista = json === null ? [] : lerCvesNvd(json);
    if (!lista) throw new BaseIndisponivel('NVD', 'resposta fora do formato');
    const achado = lista.find((c) => c.cve === cve) ?? null;
    await cache.gravar('NVD', [{ chave, dados: { cve: achado } }], validadeMs());
    return achado;
  } catch (e) {
    s.falhou('NVD', e);
    return undefined;
  }
}

/** Limpeza do cache vencido; falha aqui so vira log. */
export async function limparCache(): Promise<void> {
  try {
    await cache.limparVencidas();
  } catch (e) {
    console.error('[cruzamento] falha ao limpar o cache', e instanceof Error ? e.message : e);
  }
}
