import { falhar } from '../utils/resposta.js';
import { buscarPorId as buscarAtivo } from '../repositories/ativo.repository.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import * as repo from '../repositories/varredura.repository.js';

/** Enfileira uma varredura simulada (contrato N2 AT1: a resposta sempre traz EM_FILA). */
export async function iniciar(ativoId: string) {
  const ativo = await buscarAtivo(ativoId);
  if (!ativo) falhar(404, 'Ativo não encontrado', 'ATIVO_NAO_ENCONTRADO');
  if (ativo.status !== 'Ativo') falhar(422, 'Varredura não permitida: ativo está inativo', 'ATIVO_INATIVO');
  // RN-003: uma varredura por vez no mesmo ativo. Antes de checar, grava o status que o
  // tempo ja determinou (a anterior pode ter concluido sem ninguem ter lido).
  await avancarVarreduras();
  const scan = await repo.criarSeLivre(ativo.id);
  if (!scan) falhar(409, 'Já existe uma varredura em andamento para este ativo', 'VARREDURA_EM_ANDAMENTO');
  return { scanId: scan.id, ativoId: ativo.id, statusVarredura: 'EM_FILA', criadoEm: scan.criadoEm.toISOString() };
}

/** Lista tecnica das varreduras; o status (e os achados) avancam aqui, na leitura. */
export async function listar() {
  await avancarVarreduras();
  return repo.listar();
}
