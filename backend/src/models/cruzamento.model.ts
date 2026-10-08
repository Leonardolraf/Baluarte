import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { cveValido, cweValido, faixaCvss, notaCvss } from '../services/cvss.service.js';
import type { PassoRemediacao } from './catalogoAchado.model.js';

// Model do cruzamento do inventario das estacoes com as bases publicas de vulnerabilidades
// (B14): tipos, leitura das respostas do OSV e do NVD (o formato externo vira um formato
// reduzido, que e o que vai para o cache) e a montagem do achado. A regra do :id da rota
// POST /estacoes/:id/verificar e a do painel (PARAMETRO_ID, em estacao.model.ts).

export const BASES = ['OSV', 'NVD'] as const;
export type BaseVulnerabilidade = (typeof BASES)[number];

// ---- Limites de cada verificacao ------------------------------------------------

/** Pacotes por requisicao ao querybatch do OSV. */
export const LOTE_OSV = 500;
/** Registros completos do OSV buscados (fora do cache) por verificacao; o resto fica para a proxima. */
export const LIMITE_DETALHES_OSV = 300;
/** Requisicoes simultaneas ao OSV. */
export const CONCORRENCIA_OSV = 8;
/** Consultas ao NVD por verificacao: o limite publico e 5 a cada 30 s sem chave e 50 com chave. */
export const LIMITE_NVD_SEM_CHAVE = 5;
export const LIMITE_NVD_COM_CHAVE = 40;

/** Validade do cache em horas (VULN_CACHE_HORAS, padrao 24, de 1 a 720). */
export function validadeCacheHoras(): number {
  const h = Number(process.env.VULN_CACHE_HORAS);
  return Number.isInteger(h) && h >= 1 && h <= 720 ? h : 24;
}

// ---- Do inventario para a consulta -----------------------------------------------

/** O que o cruzamento precisa do sistema operacional da estacao. */
export interface SistemaEstacao {
  soPlataforma: string | null;
  soNome: string | null;
  soVersao: string | null;
}

function plataforma(so: SistemaEstacao): string {
  if (so.soPlataforma) return so.soPlataforma.toLowerCase();
  const nome = (so.soNome ?? '').toLowerCase();
  if (nome.startsWith('ubuntu')) return 'ubuntu';
  if (nome.startsWith('debian')) return 'debian';
  if (nome.startsWith('almalinux')) return 'almalinux';
  if (nome.startsWith('rocky')) return 'rocky';
  return '';
}

/**
 * Ecossistema do OSV para os pacotes de uma fonte do inventario, ou null quando nao ha
 * suporte. deb: Debian ("Debian:12") e Ubuntu ("Ubuntu:22.04:LTS"; as versoes LTS levam o
 * sufixo). rpm: AlmaLinux e Rocky Linux ("AlmaLinux:9"). RHEL, SUSE e outros ficam de fora
 * (o OSV os indexa por CPE da distribuicao, que o osquery nao informa).
 */
export function ecossistemaOsv(fonte: string, so: SistemaEstacao): string | null {
  const p = plataforma(so);
  const versao = so.soVersao ?? '';
  const major = versao.match(/^(\d+)/)?.[1];
  if (fonte === 'deb_packages') {
    if (p === 'debian') return major ? `Debian:${major}` : null;
    if (p === 'ubuntu') {
      const m = versao.match(/^(\d{2})\.(\d{2})/);
      if (!m) return null;
      const lts = /\bLTS\b/i.test(versao) || (Number(m[1]) % 2 === 0 && m[2] === '04');
      return `Ubuntu:${m[1]}.${m[2]}${lts ? ':LTS' : ''}`;
    }
    return null;
  }
  if (fonte === 'rpm_packages') {
    if (p === 'almalinux') return major ? `AlmaLinux:${major}` : null;
    if (p === 'rocky') return major ? `Rocky Linux:${major}` : null;
  }
  return null;
}

/**
 * Pacote consultado no OSV. No deb, o Debian e o Ubuntu indexam pelo pacote-fonte (o binario
 * libssl3 vem do fonte openssl); a coluna source do dpkg traz a versao entre parenteses quando
 * ela difere da do binario ("gcc-12 (12.2.0-14)").
 */
export function pacoteDeConsulta(p: { nome: string; versao: string; pacoteOrigem: string | null }): { nome: string; versao: string } {
  const origem = p.pacoteOrigem?.trim();
  if (!origem) return { nome: p.nome, versao: p.versao };
  const m = origem.match(/^(\S+)\s*\(([^)]+)\)$/);
  return m ? { nome: m[1], versao: m[2].trim() } : { nome: origem, versao: p.versao };
}

// ---- Respostas do OSV ------------------------------------------------------------

const loteOsv = z.object({
  results: z.array(z.object({ vulns: z.array(z.object({ id: z.string().min(1).max(200) })).optional() }).passthrough()),
});

/** Ids por consulta, na ordem enviada; null se a resposta nao tem o formato esperado. */
export function lerLoteOsv(json: unknown, quantidade: number): string[][] | null {
  const r = loteOsv.safeParse(json);
  if (!r.success || r.data.results.length !== quantidade) return null;
  return r.data.results.map((x) => [...new Set((x.vulns ?? []).map((v) => v.id))]);
}

/** Vulnerabilidade do OSV reduzida ao que o cruzamento usa (e o que vai para o cache). */
export interface VulnOsv {
  id: string;
  retirada: boolean;
  /** CVEs do registro: o proprio id, os aliases e os upstream (boletins como USN/DSA juntam varios). */
  cves: string[];
  /** Vetor CVSS 3.x publicado no registro (ou nos pacotes afetados), se houver. */
  vetor: string | null;
  cwe: string | null;
  resumo: string;
  /** Versao corrigida por ecossistema e pacote (eventos "fixed" dos intervalos ECOSYSTEM). */
  corrigidas: { ecossistema: string; pacote: string; versao: string }[];
}

const severidadeOsv = z.array(z.object({ type: z.string(), score: z.string() }).passthrough()).optional().catch(undefined);

const vulnOsvBruta = z
  .object({
    id: z.string().min(1).max(200),
    summary: z.string().optional().catch(undefined),
    details: z.string().optional().catch(undefined),
    aliases: z.array(z.string()).optional().catch(undefined),
    upstream: z.array(z.string()).optional().catch(undefined),
    withdrawn: z.string().optional().catch(undefined),
    severity: severidadeOsv,
    database_specific: z.object({ cwe_ids: z.array(z.string()).optional() }).passthrough().optional().catch(undefined),
    affected: z
      .array(
        z
          .object({
            package: z.object({ name: z.string().optional(), ecosystem: z.string().optional() }).passthrough().optional(),
            ranges: z.array(z.object({ type: z.string(), events: z.array(z.record(z.string(), z.unknown())) }).passthrough()).optional(),
            severity: severidadeOsv,
          })
          .passthrough(),
      )
      .optional()
      .catch(undefined),
  })
  .passthrough();

const CVE_NO_TEXTO = /CVE-\d{4}-\d{4,7}/;

function vetorV3(lista: { type: string; score: string }[] | undefined): string | null {
  return lista?.find((s) => s.type === 'CVSS_V3' && /^CVSS:3\.[01]\//.test(s.score))?.score ?? null;
}

/** Le o registro completo do OSV (GET /v1/vulns/{id}); null se nao tem o formato esperado. */
export function lerVulnOsv(json: unknown): VulnOsv | null {
  const r = vulnOsvBruta.safeParse(json);
  if (!r.success) return null;
  const v = r.data;
  const cves = new Set<string>();
  for (const id of [v.id, ...(v.aliases ?? []), ...(v.upstream ?? [])]) {
    const m = id.match(CVE_NO_TEXTO);
    // "CVE-2024-1", "DEBIAN-CVE-2024-1", "UBUNTU-CVE-2024-1" -> CVE-2024-1
    if (m && (id === m[0] || id.endsWith(m[0])) && cveValido(m[0])) cves.add(m[0]);
  }
  const vetor = vetorV3(v.severity) ?? (v.affected ?? []).map((a) => vetorV3(a.severity)).find(Boolean) ?? null;
  const corrigidas: VulnOsv['corrigidas'] = [];
  for (const a of v.affected ?? []) {
    const eco = a.package?.ecosystem, pacote = a.package?.name;
    if (!eco || !pacote) continue;
    for (const faixa of a.ranges ?? []) {
      if (faixa.type !== 'ECOSYSTEM') continue;
      const fixed = faixa.events.map((e) => e.fixed).filter((f): f is string => typeof f === 'string').at(-1);
      if (fixed) corrigidas.push({ ecossistema: eco, pacote, versao: fixed.slice(0, 255) });
    }
    if (corrigidas.length >= 50) break;
  }
  const resumo = (v.summary || v.details || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return {
    id: v.id,
    retirada: Boolean(v.withdrawn),
    cves: [...cves],
    vetor,
    cwe: (v.database_specific?.cwe_ids ?? []).find(cweValido) ?? null,
    resumo,
    corrigidas: corrigidas.slice(0, 50),
  };
}

// ---- Respostas do NVD ------------------------------------------------------------

/** CVE do NVD reduzido ao que o cruzamento usa (e o que vai para o cache). */
export interface CveNvd {
  cve: string;
  vetor: string | null;
  cwe: string | null;
  descricao: string;
}

const metricaNvd = z.object({ type: z.string().optional(), cvssData: z.object({ vectorString: z.string() }).passthrough() }).passthrough();
const textoNvd = z.array(z.object({ lang: z.string(), value: z.string() }).passthrough());

const cveNvdBruto = z.object({
  cve: z
    .object({
      id: z.string(),
      vulnStatus: z.string().optional().catch(undefined),
      descriptions: textoNvd.optional().catch(undefined),
      metrics: z
        .object({ cvssMetricV31: z.array(metricaNvd).optional().catch(undefined), cvssMetricV30: z.array(metricaNvd).optional().catch(undefined) })
        .passthrough()
        .optional()
        .catch(undefined),
      weaknesses: z.array(z.object({ description: textoNvd }).passthrough()).optional().catch(undefined),
    })
    .passthrough(),
});

const respostaNvd = z.object({ totalResults: z.number().optional(), vulnerabilities: z.array(z.unknown()) }).passthrough();

function vetorNvd(lista: z.infer<typeof metricaNvd>[] | undefined): string | null {
  if (!lista?.length) return null;
  return (lista.find((m) => m.type === 'Primary') ?? lista[0]).cvssData.vectorString;
}

/** Le a resposta da API de CVEs; CVE rejeitado ou sem id valido fica de fora. null se o formato nao confere. */
export function lerCvesNvd(json: unknown): CveNvd[] | null {
  const r = respostaNvd.safeParse(json);
  if (!r.success) return null;
  const lista: CveNvd[] = [];
  for (const bruto of r.data.vulnerabilities) {
    const c = cveNvdBruto.safeParse(bruto);
    if (!c.success || !cveValido(c.data.cve.id) || c.data.cve.vulnStatus === 'Rejected') continue;
    const cve = c.data.cve;
    const cwe = (cve.weaknesses ?? []).flatMap((w) => w.description.map((d) => d.value)).find(cweValido) ?? null;
    lista.push({
      cve: cve.id,
      vetor: vetorNvd(cve.metrics?.cvssMetricV31) ?? vetorNvd(cve.metrics?.cvssMetricV30),
      cwe,
      descricao: (cve.descriptions?.find((d) => d.lang === 'en')?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    });
  }
  return lista;
}

// ---- Vetor, nota e severidade ----------------------------------------------------

const METRICAS_BASE = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];

/**
 * Vetor base CVSS 3.1 a partir do publicado: so as 8 metricas base, na ordem da especificacao
 * (metricas temporais e ambientais saem). Vetor 3.0 vira 3.1: as metricas base e as formulas
 * sao as mesmas, so o arredondamento mudou (a nota pode diferir em 0,1). null se invalido.
 */
export function vetorBase31(vetor: string | null | undefined): { vetor: string; era30: boolean } | null {
  if (!vetor) return null;
  const m = vetor.trim().match(/^CVSS:3\.([01])\/(.+)$/);
  if (!m) return null;
  const valores = new Map<string, string>();
  for (const parte of m[2].split('/')) {
    const [k, v] = parte.split(':');
    if (METRICAS_BASE.includes(k)) {
      if (valores.has(k)) return null;
      valores.set(k, v);
    }
  }
  const normalizado = `CVSS:3.1/${METRICAS_BASE.map((k) => `${k}:${valores.get(k)}`).join('/')}`;
  return notaCvss(normalizado) === null ? null : { vetor: normalizado, era30: m[1] === '0' };
}

/** Uma vulnerabilidade confirmada num programa da estacao, pronta para virar achado. */
export interface AchadoEstacao {
  programa: string;
  programaVersao: string;
  cve: string;
  base: BaseVulnerabilidade;
  /** Vetor publicado (3.0 ou 3.1); a nota sai dele, convertido para a base 3.1. */
  vetor: string;
  cwe: string | null;
  resumo: string;
  /** Registro de origem: id do OSV ("DEBIAN-CVE-2024-1", "USN-1-1") ou o proprio CVE no NVD. */
  registro: string;
  /** De onde veio a linha do inventario (ex.: "deb_packages: libssl3, openssl; OSV Debian:12"). */
  origem: string;
  corrigidaEm: string | null;
}

export const CATEGORIA_COMPONENTE = 'A06:2021 - Vulnerable and Outdated Components';

function remediacao(a: AchadoEstacao): PassoRemediacao[] {
  if (a.base === 'OSV') {
    const alvo = a.corrigidaEm ? `para a versão ${a.corrigidaEm} ou mais nova` : 'assim que a distribuição publicar a versão corrigida';
    return [
      { titulo: 'Atualizar o pacote', descricao: `Atualizar ${a.programa} pelo gerenciador de pacotes da distribuição (apt ou dnf) ${alvo} e reiniciar os serviços que o usam.`, esforco: 'baixo' },
      { titulo: 'Conferir o boletim', descricao: `Ler o registro ${a.registro} em https://osv.dev/vulnerability/${encodeURIComponent(a.registro)} para saber se há mitigação enquanto a correção não chega.`, esforco: 'baixo' },
    ];
  }
  return [
    { titulo: 'Atualizar o programa', descricao: `Atualizar ${a.programa} para a versão mais recente do fornecedor (a ${a.programaVersao} instalada é afetada pelo ${a.cve}).`, esforco: 'baixo' },
    { titulo: 'Conferir o CVE', descricao: `Ler https://nvd.nist.gov/vuln/detail/${a.cve} para confirmar as versões corrigidas e as mitigações.`, esforco: 'baixo' },
  ];
}

/** Dados do Finding (sem scanId nem workstationId): nota calculada do vetor, severidade da nota. */
export function dadosAchadoEstacao(a: AchadoEstacao) {
  const base = vetorBase31(a.vetor);
  if (!base || !cveValido(a.cve)) throw new Error(`achado de estação inválido: ${a.cve} ${a.vetor}`);
  const cvss = notaCvss(base.vetor)!;
  const resumo = a.resumo ? `: ${a.resumo}` : '';
  return {
    categoriaOwasp: CATEGORIA_COMPONENTE,
    descricao: `${a.cve} em ${a.programa} ${a.programaVersao}${resumo}`.slice(0, 500),
    evidencia: `Inventário do osquery: ${a.origem}. Registro ${a.registro} (${a.base}).${base.era30 ? ' Vetor publicado em CVSS 3.0; nota pela fórmula 3.1.' : ''}`.slice(0, 1000),
    cwe: a.cwe && cweValido(a.cwe) ? a.cwe : null,
    cve: a.cve,
    cvssVetor: base.vetor,
    cvss,
    severidade: faixaCvss(cvss),
    remediacao: remediacao(a) as unknown as Prisma.InputJsonValue,
    programa: a.programa.slice(0, 512),
    programaVersao: a.programaVersao.slice(0, 255),
    baseVulnerabilidade: a.base,
  };
}

/** Resumo de uma verificacao (resposta da rota e log do cruzamento automatico). */
export interface ResultadoVerificacao {
  estacaoId: string;
  ativoId: string;
  host: string;
  verificadaEm: string;
  programasConsultados: number;
  /** Programas que nao tem como ser consultados (Windows fora da tabela, sistema sem suporte no OSV). */
  programasSemCobertura: number;
  vulnerabilidadesEncontradas: number;
  achadosNovos: number;
  achadosExistentes: number;
  /** CVEs sem vetor CVSS 3.x em nenhuma base: nao viram achado (a nota nao e inventada). */
  semCvss: number;
  /** Consultas que ficaram para a proxima verificacao (limite por verificacao). */
  pendentes: number;
  /** Bases que falharam nesta verificacao (os achados delas ficam para a proxima). */
  falhas: BaseVulnerabilidade[];
  varreduraId: string | null;
}
