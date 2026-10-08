import { falhar } from '../utils/resposta.js';
import { CICLOS_ATE_OFFLINE, type EstacaoComContagem, type EstacaoComInventario, type StatusConexao } from '../models/estacao.model.js';
import { intervaloQueries } from './agente.service.js';
import * as repo from '../repositories/estacao.repository.js';

// Painel de estacoes monitoradas (B13): lista com status online/offline e detalhe com os
// programas instalados e as portas abertas. So leitura; quem escreve e o agente (B07) e o
// cruzamento com as bases de vulnerabilidades (B14, cruzamento.service.ts).

/** Segundos sem contato ate a estacao virar "Offline": CICLOS_ATE_OFFLINE x intervalo de coleta. */
export function janelaOfflineS(): number {
  return CICLOS_ATE_OFFLINE * intervaloQueries();
}

/** Online enquanto o ultimo contato estiver dentro da janela (o limite exato ainda conta). */
export function statusConexao(ultimoContato: Date, janelaS: number, agora: number = Date.now()): StatusConexao {
  return agora - ultimoContato.getTime() <= janelaS * 1000 ? 'Online' : 'Offline';
}

type EstacaoBase = Omit<EstacaoComContagem, '_count'>;

function mapBase(e: EstacaoBase, janelaS: number, agora: number) {
  return {
    id: e.id,
    ativoId: e.assetId,
    nome: e.asset.nome,
    host: e.asset.host,
    identificador: e.hostIdentifier,
    sistema: e.sistema,
    soNome: e.soNome,
    soVersao: e.soVersao,
    soBuild: e.soBuild,
    soPlataforma: e.soPlataforma,
    status: statusConexao(e.vistaEm, janelaS, agora),
    ultimoContato: e.vistaEm,
    inscritaEm: e.inscritaEm,
    inventarioEm: e.inventarioEm,
    // B14: ultimo cruzamento do inventario com as bases de vulnerabilidades (null: nunca).
    verificadaEm: e.verificadaEm,
  };
}

/** Lista com o total de online e offline no resumo. */
export async function listar() {
  const janelaS = janelaOfflineS();
  const agora = Date.now();
  const lista = (await repo.listar()).map((e) => ({
    ...mapBase(e, janelaS, agora),
    totalProgramas: e._count.programas,
    totalPortas: e._count.portas,
  }));
  const online = lista.filter((e) => e.status === 'Online').length;
  return { lista, resumo: { total: lista.length, online, offline: lista.length - online, janelaOfflineS: janelaS } };
}

function mapDetalhe(e: EstacaoComInventario, janelaS: number, agora: number, achados: { total: number; abertos: number }) {
  return {
    ...mapBase(e, janelaS, agora),
    // B14: achados da estacao (programas com CVE), todos e os ainda em aberto.
    totalAchados: achados.total,
    achadosAbertos: achados.abertos,
    totalProgramas: e.programas.length,
    totalPortas: e.portas.length,
    janelaOfflineS: janelaS,
    programas: e.programas.map((p) => ({ nome: p.nome, versao: p.versao, fornecedor: p.fornecedor, fonte: p.fonte })),
    portas: e.portas.map((p) => ({ porta: p.porta, protocolo: p.protocolo, endereco: p.endereco, processo: p.processo })),
  };
}

/** Detalhe com programas instalados e portas abertas; 404 se a estacao nao existe. */
export async function detalhe(id: string) {
  const estacao = await repo.buscarComInventario(id);
  if (!estacao) falhar(404, 'Estação não encontrada', 'ESTACAO_NAO_ENCONTRADA');
  return mapDetalhe(estacao, janelaOfflineS(), Date.now(), await repo.contarAchados(estacao.id));
}
