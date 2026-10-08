import { timingSafeEqual } from 'node:crypto';
import { falhar } from '../utils/resposta.js';
import { gerarTokenLink, hashToken } from '../utils/tokens.js';
import {
  detalhesInscricao,
  eventoResultado,
  intervaloDaCategoriaNoBase,
  INTERVALO_DEV_S,
  INTERVALO_MAX_S,
  INTERVALO_MIN_S,
  INTERVALO_PRODUCAO_S,
  linhaPorta,
  linhaPrograma,
  linhaSistema,
  PROTOCOLOS,
  QUERIES,
  SPLAY_PERCENTUAL,
  type CategoriaQuery,
  type Estacao,
  type ItemPorta,
  type ItemPrograma,
  type SistemaOperacional,
} from '../models/agente.model.js';
import { registrarAuditoria } from './auditoria.service.js';
import { verificarEmSegundoPlano } from './cruzamento.service.js';
import * as repo from '../repositories/agente.repository.js';

// Lado servidor do protocolo remoto TLS do osquery (B07). O osquery se inscreve com o
// segredo compartilhado (OSQUERY_ENROLL_SECRET), recebe a chave da estacao (node_key) e
// passa a usa-la para buscar a configuracao e enviar os resultados das queries.

/** Segredo menor que isso nao liga a inscricao (seria adivinhavel). */
export const TAMANHO_MINIMO_SEGREDO = 16;

/** Segredo configurado no ambiente, ou null (inscricao desligada). */
export function segredoConfigurado(): string | null {
  const s = process.env.OSQUERY_ENROLL_SECRET?.trim();
  return s && s.length >= TAMANHO_MINIMO_SEGREDO ? s : null;
}

/**
 * Compara o segredo em tempo constante: os dois lados viram SHA-256 (mesmo tamanho, o que
 * o timingSafeEqual exige), entao nem o tamanho do segredo vaza pelo tempo de resposta.
 */
export function segredoConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(hashToken(recebido), 'hex');
  const b = Buffer.from(hashToken(esperado), 'hex');
  return timingSafeEqual(a, b);
}

/**
 * Intervalo-base das queries em segundos (o dos programas): OSQUERY_INTERVALO_S, ou 1 h em
 * producao e 5 min fora. E tambem a base da janela de online/offline do painel (B13).
 */
export function intervaloQueries(): number {
  const bruto = Number(process.env.OSQUERY_INTERVALO_S);
  if (Number.isInteger(bruto) && bruto >= INTERVALO_MIN_S && bruto <= INTERVALO_MAX_S) return bruto;
  return process.env.NODE_ENV === 'production' ? INTERVALO_PRODUCAO_S : INTERVALO_DEV_S;
}

/** Intervalo de uma categoria (B08): base x FATOR_INTERVALO, entre o minimo e o maximo. */
export function intervaloDaCategoria(categoria: CategoriaQuery, base: number = intervaloQueries()): number {
  return intervaloDaCategoriaNoBase(categoria, base);
}

/** Configuracao do osquery (mesmo formato do arquivo osquery.conf). */
export function configuracao() {
  const base = intervaloQueries();
  const schedule = Object.fromEntries(
    Object.entries(QUERIES).map(([nome, q]) => [
      nome,
      {
        query: q.query,
        interval: intervaloDaCategoria(q.categoria, base),
        snapshot: true,
        ...(q.platform ? { platform: q.platform } : {}),
      },
    ]),
  );
  // splay: espalha as execucoes para as estacoes nao consultarem todas no mesmo instante.
  return { options: { schedule_splay_percent: SPLAY_PERCENTUAL }, schedule };
}

function sistemaDe(linha: { name?: string | null; version?: string | null; build?: string | null; platform?: string | null } | undefined, reserva: string): SistemaOperacional {
  const soNome = linha?.name ?? null;
  const soVersao = linha?.version ?? null;
  const rotulo = [soNome, soVersao && !soNome?.includes(soVersao) ? soVersao : null].filter(Boolean).join(' ');
  return {
    sistema: (rotulo || reserva).slice(0, 255),
    soNome,
    soVersao,
    soBuild: linha?.build ?? null,
    soPlataforma: linha?.platform ?? null,
  };
}

/** Host do ativo da estacao: o hostname, sem colidir com um ativo ja cadastrado. */
async function hostLivre(base: string, hostIdentifier: string): Promise<string> {
  const limpo = base.trim().toLowerCase().slice(0, 200) || 'estacao';
  const candidatos = [limpo, `${limpo}-${hashToken(hostIdentifier).slice(0, 8)}`];
  for (const c of candidatos) if (!(await repo.hostDeAtivoEmUso(c))) return c;
  return `${limpo}-${gerarTokenLink().slice(0, 12)}`;
}

/**
 * Inscricao (enroll). Segredo certo: devolve a chave da estacao e guarda so o hash dela.
 * A mesma estacao (mesmo host_identifier) pode se reinscrever: ganha chave nova e a antiga
 * deixa de valer — e o que o osquery faz quando perde a chave ou recebe node_invalid.
 */
export async function inscrever(dados: { segredo: unknown; hostIdentifier: string; hostDetails: unknown }): Promise<string> {
  const esperado = segredoConfigurado();
  if (!esperado) falhar(503, 'Inscrição de estações desligada no servidor', 'INSCRICAO_DESLIGADA');
  if (typeof dados.segredo !== 'string' || !segredoConfere(dados.segredo.trim(), esperado))
    falhar(401, 'Segredo de inscrição inválido', 'SEGREDO_INVALIDO');

  const detalhes = detalhesInscricao.parse(dados.hostDetails ?? {});
  const so = sistemaDe(detalhes.os_version, 'Desconhecido');
  const nodeKey = gerarTokenLink();
  const nodeKeyHash = hashToken(nodeKey);

  const existente = await repo.buscarPorHostIdentifier(dados.hostIdentifier);
  if (existente) {
    await repo.reinscrever(existente.id, nodeKeyHash, so);
    await registrarAuditoria(null, 'INSCREVER_ESTACAO', `host_identifier=${dados.hostIdentifier}; reinscrição; ativo=${existente.assetId}`);
    return nodeKey;
  }

  const hostname = detalhes.system_info?.hostname ?? dados.hostIdentifier;
  const nome = (detalhes.system_info?.computer_name ?? hostname).slice(0, 255);
  const estacao = await repo.criarComAtivo({
    ativo: { nome, host: await hostLivre(hostname, dados.hostIdentifier) },
    hostIdentifier: dados.hostIdentifier,
    nodeKeyHash,
    so,
  });
  await registrarAuditoria(null, 'INSCREVER_ESTACAO', `host_identifier=${dados.hostIdentifier}; ativo=${estacao.assetId}`);
  return nodeKey;
}

/** Estacao dona da chave, ou null (chave desconhecida: o osquery deve se reinscrever). */
export function estacaoDaChave(nodeKey: string): Promise<Estacao | null> {
  return repo.buscarPorNodeKeyHash(hashToken(nodeKey));
}

/** Configuracao para uma estacao inscrita; null se a chave nao vale. */
export async function configuracaoDaEstacao(nodeKey: string) {
  const estacao = await estacaoDaChave(nodeKey);
  if (!estacao) return null;
  await repo.marcarVista(estacao.id);
  return configuracao();
}

function programasDe(linhas: Record<string, unknown>[]): ItemPrograma[] {
  const vistos = new Map<string, ItemPrograma>();
  for (const l of linhas) {
    const r = linhaPrograma.safeParse(l);
    if (!r.success) continue;
    const origem = r.data.origem && r.data.origem !== r.data.name ? r.data.origem : null;
    const item = { nome: r.data.name, versao: r.data.version, fornecedor: r.data.fornecedor, pacoteOrigem: origem };
    vistos.set(`${item.nome}\u0001${item.versao}`, item);
  }
  return [...vistos.values()];
}

function portasDe(linhas: Record<string, unknown>[]): ItemPorta[] {
  const vistas = new Map<string, ItemPorta>();
  for (const l of linhas) {
    const r = linhaPorta.safeParse(l);
    if (!r.success) continue;
    const item = { porta: r.data.port, protocolo: PROTOCOLOS[r.data.protocol], endereco: r.data.address, processo: r.data.processo };
    vistas.set(`${item.porta}/${item.protocolo}/${item.endereco}`, item);
  }
  return [...vistas.values()];
}

/**
 * Recebimento de logs. `status` so atualiza o visto-por-ultimo; `result` com snapshot das
 * queries do Baluarte substitui o inventario da categoria. Eventos de outras queries ou
 * fora do formato sao ignorados (o osquery nao reenviaria nada diferente). Programas novos
 * disparam o cruzamento com as bases de vulnerabilidades (B14) em segundo plano. Devolve
 * false se a chave nao vale.
 */
export async function receberLog(nodeKey: string, tipo: string, eventos: unknown[]): Promise<boolean> {
  const estacao = await estacaoDaChave(nodeKey);
  if (!estacao) return false;
  if (tipo !== 'result') {
    await repo.marcarVista(estacao.id);
    return true;
  }
  let gravou = false;
  let programasNovos = false;
  for (const bruto of eventos) {
    const ev = eventoResultado.safeParse(bruto);
    if (!ev.success || !ev.data.snapshot) continue;
    const q = QUERIES[ev.data.name];
    if (!q) continue;
    const linhas = ev.data.snapshot;
    if (q.categoria === 'programas' && q.fonte) {
      await repo.substituirProgramas(estacao.id, q.fonte, programasDe(linhas));
      programasNovos = true;
    } else if (q.categoria === 'portas') await repo.substituirPortas(estacao.id, portasDe(linhas));
    else if (q.categoria === 'sistema') {
      const linha = linhaSistema.safeParse(linhas[0] ?? {});
      if (!linha.success || !linha.data.name) continue;
      await repo.atualizarSistema(estacao.id, sistemaDe(linha.data, estacao.sistema));
    }
    gravou = true;
  }
  if (!gravou) await repo.marcarVista(estacao.id);
  // B14: inventario de programas novo -> cruzamento com as bases de vulnerabilidades, sem
  // segurar a resposta ao agente (e sem rodar onde o processo congela depois de responder).
  if (programasNovos) verificarEmSegundoPlano(estacao.id);
  return true;
}
