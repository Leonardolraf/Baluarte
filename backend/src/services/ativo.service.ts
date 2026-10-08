import { falhar } from '../utils/resposta.js';
import { STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import * as repo from '../repositories/ativo.repository.js';

/** Cadastro de ativo (contrato N2 AT1). O host e unico. */
export async function cadastrar(dados: { nome: string; tipo: string; host: string }) {
  if (await repo.buscarPorHost(dados.host)) falhar(409, 'Ativo já cadastrado', 'ATIVO_DUPLICADO');
  const ativo = await repo.criar(dados);
  return { id: ativo.id, nome: ativo.nome, tipo: ativo.tipo, host: ativo.host, status: ativo.status };
}

/**
 * Ativos com achadosAbertos e ultimaVarredura prontos (o frontend nao precisa cruzar as
 * listas de vulnerabilidades e varreduras). "Aberto" = mesma regra dos KPIs do dashboard.
 */
export async function listar() {
  await avancarVarreduras();
  const ativos = await repo.listarComVarreduras();
  return ativos.map(({ scans, ...ativo }) => ({
    ...ativo,
    achadosAbertos: scans.reduce((n, s) => n + s.findings.filter((f) => !STATUS_FINDING_ENCERRADO.includes(f.status)).length, 0),
    ultimaVarredura: scans[0]
      ? { id: scans[0].id, status: scans[0].status, criadoEm: scans[0].criadoEm, concluidoEm: scans[0].concluidoEm }
      : null,
  }));
}
