import { falhar, ErroNegocio } from '../utils/resposta.js';
import {
  dadosAchadoEstacao,
  ecossistemaOsv,
  pacoteDeConsulta,
  vetorBase31,
  type AchadoEstacao,
  type ResultadoVerificacao,
  type VulnOsv,
} from '../models/cruzamento.model.js';
import { cpeDoPrograma } from '../models/tabelaCpe.model.js';
import { registrarAuditoria } from './auditoria.service.js';
import { cvePorId, cvesPorCpe, idsOsv, limparCache, SessaoConsulta, vulnsOsv, chaveConsultaOsv } from './baseVulnerabilidade.service.js';
import * as repo from '../repositories/estacao.repository.js';

// Cruzamento do inventario das estacoes com as bases publicas de vulnerabilidades (B14).
//  - Pacotes Linux (deb no Debian/Ubuntu, rpm no AlmaLinux/Rocky): OSV, pelo pacote e versao.
//  - Programas Windows: tabela dos mais comuns -> CPE (models/tabelaCpe.model.ts), consultada no NVD.
// Cada vulnerabilidade com CVE e vetor CVSS 3.x vira um achado (Finding) da estacao, numa
// varredura propria e ja concluida no ativo dela, e por isso entra no dashboard e na lista de
// vulnerabilidades junto com os achados do scanner. Estacao + CVE + programa nao se repete.
// Quando: POST /estacoes/:id/verificar (Administrador/Analista) e, num servidor de longa
// duracao, depois de cada inventario de programas recebido (sem segurar a resposta ao agente).
// O painel das estacoes (leitura, B13) fica em estacao.service.ts; os dois usam o mesmo
// estacao.repository.ts.

type Estacao = NonNullable<Awaited<ReturnType<typeof repo.buscarParaVerificacao>>>;

/** Estacoes com verificacao em curso neste processo (uma por vez em cada estacao). */
const emAndamento = new Set<string>();
/** Verificacoes disparadas em segundo plano (os testes esperam por elas). */
const emSegundoPlano = new Set<Promise<void>>();

const chave = (cve: string, programa: string) => `${cve}\u0001${programa}`;

interface GrupoOsv {
  ecossistema: string;
  pacote: string;
  versao: string;
  fonte: string;
  binarios: Set<string>;
}

/** Pacotes Linux da estacao agrupados por consulta ao OSV (varios binarios, um pacote-fonte). */
function gruposOsv(estacao: Estacao): { grupos: Map<string, GrupoOsv>; consultados: number; semCobertura: number } {
  const grupos = new Map<string, GrupoOsv>();
  let consultados = 0, semCobertura = 0;
  for (const p of estacao.programas) {
    if (p.fonte !== 'deb_packages' && p.fonte !== 'rpm_packages') continue;
    const ecossistema = ecossistemaOsv(p.fonte, estacao);
    if (!ecossistema || !p.versao) {
      semCobertura += 1;
      continue;
    }
    const pkg = p.fonte === 'deb_packages' ? pacoteDeConsulta(p) : { nome: p.nome, versao: p.versao };
    const k = chaveConsultaOsv({ ecossistema, nome: pkg.nome, versao: pkg.versao });
    const g = grupos.get(k) ?? { ecossistema, pacote: pkg.nome, versao: pkg.versao, fonte: p.fonte, binarios: new Set<string>() };
    g.binarios.add(p.nome);
    grupos.set(k, g);
    consultados += 1;
  }
  return { grupos, consultados, semCobertura };
}

function corrigidaEm(v: VulnOsv, g: GrupoOsv): string | null {
  return v.corrigidas.find((c) => c.ecossistema === g.ecossistema && c.pacote === g.pacote)?.versao ?? null;
}

/**
 * Ordem por unidade de código (a mesma do `sort()` sem argumento), explícita: nomes de pacote,
 * programas e bases são identificadores, não texto para ordenar por idioma.
 */
function porCodigo(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function origemOsv(g: GrupoOsv): string {
  const bins = [...g.binarios].sort(porCodigo);
  return `${g.fonte}: ${bins.slice(0, 5).join(', ')}${bins.length > 5 ? ` e mais ${bins.length - 5}` : ''}; OSV ${g.ecossistema}`;
}

/** Cruza os pacotes Linux com o OSV; preenche `achados` e as contagens. */
async function cruzarLinux(estacao: Estacao, s: SessaoConsulta, achados: Map<string, AchadoEstacao>, encontradas: Set<string>, semCvss: Set<string>) {
  const { grupos, consultados, semCobertura } = gruposOsv(estacao);
  if (!grupos.size) return { consultados, semCobertura };
  const ids = await idsOsv([...grupos.values()].map((g) => ({ ecossistema: g.ecossistema, nome: g.pacote, versao: g.versao })), s);
  const registros = await vulnsOsv([...new Set([...ids.values()].flat())], s);

  // CVE + programa que o OSV confirmou, com o registro de onde veio; o vetor vem do registro
  // quando ele trata de um CVE so (boletins como USN/DSA juntam varios e tem uma nota para todos).
  const semVetor = new Map<string, { cve: string; g: GrupoOsv; v: VulnOsv }>();
  for (const [k, g] of grupos) {
    for (const id of ids.get(k) ?? []) {
      const v = registros.get(id);
      if (!v || v.retirada) continue;
      for (const cve of v.cves) {
        const kk = chave(cve, g.pacote);
        encontradas.add(kk);
        if (achados.has(kk)) continue;
        const vetor = v.cves.length === 1 ? vetorBase31(v.vetor) : null;
        if (vetor && v.vetor) {
          semVetor.delete(kk);
          achados.set(kk, { programa: g.pacote, programaVersao: g.versao, cve, base: 'OSV', vetor: v.vetor, cwe: v.cwe, resumo: v.resumo, registro: v.id, origem: origemOsv(g), corrigidaEm: corrigidaEm(v, g) });
        } else if (!semVetor.has(kk) || v.cves.length === 1) {
          semVetor.set(kk, { cve, g, v });
        }
      }
    }
  }
  if (!semVetor.size) return { consultados, semCobertura };

  // Sem vetor no registro da distribuicao: o registro do proprio CVE no OSV e, se ainda faltar, o NVD.
  const doCve = await vulnsOsv([...new Set([...semVetor.values()].map((x) => x.cve))], s);
  for (const [kk, { cve, g, v }] of semVetor) {
    const registroCve = doCve.get(cve);
    let vetor = registroCve && vetorBase31(registroCve.vetor) ? registroCve.vetor : null;
    let cwe = v.cwe ?? registroCve?.cwe ?? null;
    let resumo = v.cves.length === 1 && v.resumo ? v.resumo : registroCve?.resumo || v.resumo;
    if (!vetor && doCve.has(cve)) {
      const n = await cvePorId(cve, s);
      if (n === undefined) continue; // nao consultado: fica para a proxima verificacao
      if (n && vetorBase31(n.vetor)) {
        vetor = n.vetor;
        cwe = cwe ?? n.cwe;
        resumo = resumo || n.descricao;
      }
    } else if (!vetor) continue; // registro do CVE nao consultado (falha ou limite)
    if (!vetor) {
      semCvss.add(kk);
      continue;
    }
    achados.set(kk, { programa: g.pacote, programaVersao: g.versao, cve, base: 'OSV', vetor, cwe, resumo, registro: v.id, origem: origemOsv(g), corrigidaEm: corrigidaEm(v, g) });
  }
  return { consultados, semCobertura };
}

/** Cruza os programas Windows da tabela de CPE com o NVD. */
async function cruzarWindows(estacao: Estacao, s: SessaoConsulta, achados: Map<string, AchadoEstacao>, encontradas: Set<string>, semCvss: Set<string>) {
  const porCpe = new Map<string, { programa: string; versao: string; nomes: Set<string> }>();
  let consultados = 0, semCobertura = 0;
  for (const p of estacao.programas) {
    if (p.fonte !== 'programs') continue;
    const c = cpeDoPrograma(p.nome, p.versao);
    if (!c) {
      semCobertura += 1;
      continue;
    }
    const item = porCpe.get(c.cpe) ?? { programa: c.programa, versao: c.versao, nomes: new Set<string>() };
    item.nomes.add(p.nome);
    porCpe.set(c.cpe, item);
    consultados += 1;
  }
  for (const [cpe, item] of porCpe) {
    const cves = await cvesPorCpe(cpe, s);
    if (!cves) continue;
    for (const c of cves) {
      const kk = chave(c.cve, item.programa);
      encontradas.add(kk);
      if (achados.has(kk)) continue;
      if (!vetorBase31(c.vetor)) {
        semCvss.add(kk);
        continue;
      }
      achados.set(kk, {
        programa: item.programa,
        programaVersao: item.versao,
        cve: c.cve,
        base: 'NVD',
        vetor: c.vetor!,
        cwe: c.cwe,
        resumo: c.descricao,
        registro: c.cve,
        origem: `programs: ${[...item.nomes].sort(porCodigo).join(', ')}; NVD ${cpe}`,
        corrigidaEm: null,
      });
    }
  }
  return { consultados, semCobertura };
}

async function cruzar(estacao: Estacao, atorId: string | null): Promise<ResultadoVerificacao> {
  const s = new SessaoConsulta();
  const achados = new Map<string, AchadoEstacao>();
  const encontradas = new Set<string>();
  const semCvss = new Set<string>();
  const win = await cruzarWindows(estacao, s, achados, encontradas, semCvss);
  const linux = await cruzarLinux(estacao, s, achados, encontradas, semCvss);
  const macos = estacao.programas.filter((p) => p.fonte === 'apps').length;

  const existentes = await repo.achadosExistentes(estacao.id);
  const novos = [...achados.entries()].filter(([k]) => !existentes.has(k)).map(([, a]) => a);
  const { scanId, criados } = await repo.registrarAchados(estacao.assetId, estacao.id, novos.map(dadosAchadoEstacao));
  if (criados > 0) {
    const cves = novos.map((a) => `${a.cve} (${a.programa})`);
    await registrarAuditoria(
      atorId,
      'REGISTRAR_ACHADOS_ESTACAO',
      `${criados} achado(s) novo(s) em ${estacao.asset.host} (varredura ${scanId}): ${cves.slice(0, 20).join(', ')}${cves.length > 20 ? ', …' : ''}`,
    );
  }
  const verificadaEm = new Date();
  await repo.marcarVerificada(estacao.id, verificadaEm);
  await limparCache();
  return {
    estacaoId: estacao.id,
    ativoId: estacao.assetId,
    host: estacao.asset.host,
    verificadaEm: verificadaEm.toISOString(),
    programasConsultados: win.consultados + linux.consultados,
    programasSemCobertura: win.semCobertura + linux.semCobertura + macos,
    vulnerabilidadesEncontradas: encontradas.size,
    achadosNovos: criados,
    achadosExistentes: achados.size - novos.length + (novos.length - criados),
    semCvss: semCvss.size,
    pendentes: s.pendentes,
    falhas: [...s.falhas].sort(porCodigo),
    varreduraId: scanId,
  };
}

/**
 * Verifica uma estacao agora (id da estacao ou do ativo dela). Falha das bases externas nao
 * vira erro: a resposta lista as bases em `falhas` e nada e inventado.
 */
export async function verificar(id: string, atorId: string | null): Promise<ResultadoVerificacao> {
  const estacao = await repo.buscarParaVerificacao(id);
  if (!estacao) falhar(404, 'Estação não encontrada', 'ESTACAO_NAO_ENCONTRADA');
  if (estacao.asset.status !== 'Ativo') falhar(422, 'Verificação não permitida: ativo está inativo', 'ATIVO_INATIVO');
  if (emAndamento.has(estacao.id)) falhar(409, 'Já existe uma verificação em andamento para esta estação', 'VERIFICACAO_EM_ANDAMENTO');
  emAndamento.add(estacao.id);
  try {
    const r = await cruzar(estacao, atorId);
    if (atorId)
      await registrarAuditoria(atorId, 'VERIFICAR_ESTACAO', `${r.host}: ${r.achadosNovos} achado(s) novo(s)${r.falhas.length ? `; falhas: ${r.falhas.join(', ')}` : ''}`);
    return r;
  } finally {
    emAndamento.delete(estacao.id);
  }
}

/**
 * Cruzamento automatico depois do inventario. CRUZAMENTO_AUTOMATICO=1 liga e =0 desliga; sem
 * ela, liga so num servidor de longa duracao: fica desligado na Vercel (a funcao congela depois
 * de responder e o trabalho em segundo plano morreria no meio) e nos testes.
 */
export function cruzamentoAutomatico(): boolean {
  const v = process.env.CRUZAMENTO_AUTOMATICO?.trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return !process.env.VERCEL && process.env.NODE_ENV !== 'test';
}

/** Dispara a verificacao sem esperar por ela. Nunca lanca: qualquer falha vira log. */
export function verificarEmSegundoPlano(estacaoId: string): void {
  if (!cruzamentoAutomatico() || emAndamento.has(estacaoId)) return;
  const tarefa = verificar(estacaoId, null)
    .then((r) => {
      if (r.achadosNovos || r.falhas.length)
        console.log(`[cruzamento] ${r.host}: ${r.achadosNovos} achado(s) novo(s)${r.falhas.length ? `; falhas: ${r.falhas.join(', ')}` : ''}`);
    })
    .catch((e) => {
      if (e instanceof ErroNegocio) return; // estacao inativa ou ja em verificacao
      console.error('[cruzamento] falha na verificação automática', e instanceof Error ? e.message : e);
    });
  emSegundoPlano.add(tarefa);
  void tarefa.finally(() => emSegundoPlano.delete(tarefa));
}

/** Espera as verificacoes em segundo plano em curso (usado pelos testes). */
export async function aguardarSegundoPlano(): Promise<void> {
  while (emSegundoPlano.size) await Promise.allSettled([...emSegundoPlano]);
}
