import type { CadastroAtivo } from '../models/ativo.model.js';
import { falhar } from '../utils/resposta.js';
import { STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import { registrarAuditoria } from './auditoria.service.js';
import * as repo from '../repositories/ativo.repository.js';

/** Cadastro de ativo (contrato N2 AT1). O host e unico. `ip` e `descricao` sao extensao (B10). */
export async function cadastrar(atorId: string, dados: CadastroAtivo) {
  if (await repo.buscarPorHost(dados.host)) falhar(409, 'Ativo já cadastrado', 'ATIVO_DUPLICADO');
  const ativo = await repo.criar(dados);
  // A descricao (texto livre, ate 500) fica fora do detalhe da auditoria; o IP entra quando houver.
  await registrarAuditoria(atorId, 'CRIAR_ATIVO', `${ativo.id} (${ativo.host}, ${ativo.tipo}${ativo.ip ? `, IP ${ativo.ip}` : ''})`);
  return {
    id: ativo.id,
    nome: ativo.nome,
    tipo: ativo.tipo,
    host: ativo.host,
    status: ativo.status,
    ip: ativo.ip,
    descricao: ativo.descricao,
    criadoEm: ativo.criadoEm,
  };
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
