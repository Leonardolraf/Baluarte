import { falhar } from '../utils/resposta.js';
import { buscarPorId as buscarAtivo } from '../repositories/ativo.repository.js';
import { avancarVarreduras, progressoDaVarredura } from './cicloVarredura.service.js';
import { registrarAuditoria } from './auditoria.service.js';
import * as repo from '../repositories/varredura.repository.js';

/** Enfileira uma varredura simulada (contrato N2 AT1: a resposta sempre traz EM_FILA). */
export async function iniciar(atorId: string, ativoId: string) {
  const ativo = await buscarAtivo(ativoId);
  if (!ativo) falhar(404, 'Ativo não encontrado', 'ATIVO_NAO_ENCONTRADO');
  if (ativo.status !== 'Ativo') falhar(422, 'Varredura não permitida: ativo está inativo', 'ATIVO_INATIVO');
  // RN-003: uma varredura por vez no mesmo ativo. Antes de checar, grava o status que o
  // tempo ja determinou (a anterior pode ter concluido sem ninguem ter lido).
  await avancarVarreduras();
  const scan = await repo.criarSeLivre(ativo.id);
  if (!scan) falhar(409, 'Já existe uma varredura em andamento para este ativo', 'VARREDURA_EM_ANDAMENTO');
  await registrarAuditoria(atorId, 'INICIAR_VARREDURA', `${scan.id} no ativo ${ativo.id} (${ativo.host})`);
  return { scanId: scan.id, ativoId: ativo.id, statusVarredura: 'EM_FILA', criadoEm: scan.criadoEm.toISOString() };
}

type VarreduraLida = NonNullable<Awaited<ReturnType<typeof repo.buscar>>>;

/** Varredura como a API devolve: o registro do banco mais progresso, etapa e estimativa (B26). */
function comProgresso(scan: VarreduraLida, agora: Date) {
  return { ...scan, ...progressoDaVarredura(scan, agora) };
}

/**
 * Lista tecnica das varreduras; o status (e os achados) avancam aqui, na leitura. O mesmo
 * `agora` avanca e calcula o progresso, entao status e progresso nao se contradizem.
 */
export async function listar() {
  const agora = new Date();
  await avancarVarreduras(agora);
  return (await repo.listar()).map((scan) => comProgresso(scan, agora));
}

/** Uma varredura (B26): avanca as pendentes, como a lista, e devolve so esta. */
export async function detalhe(id: string) {
  const agora = new Date();
  await avancarVarreduras(agora);
  const scan = await repo.buscar(id);
  if (!scan) falhar(404, 'Varredura não encontrada', 'VARREDURA_NAO_ENCONTRADA');
  return comProgresso(scan, agora);
}
