import type { CadastroAtivo } from '../models/ativo.model.js';
import { falhar } from '../utils/resposta.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import { registrarAuditoria } from './auditoria.service.js';
import { abertosPorAtivo, riscoDe } from './riscoAtivo.service.js';
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
 * Ativos com achadosAbertos, ultimaVarredura e a nota de risco prontos (o frontend nao
 * precisa cruzar as listas de vulnerabilidades e varreduras). "Aberto" = mesma regra dos
 * KPIs do dashboard. A nota (0 a 100) e calculada nesta leitura (services/riscoAtivo.service.ts),
 * junto com os abertos por severidade.
 */
export async function listar() {
  await avancarVarreduras();
  const [ativos, abertos] = await Promise.all([repo.listarComVarreduras(), abertosPorAtivo()]);
  return ativos.map(({ scans, ...ativo }) => ({
    ...ativo,
    ...riscoDe(abertos.get(ativo.id)),
    ultimaVarredura: scans[0]
      ? { id: scans[0].id, status: scans[0].status, criadoEm: scans[0].criadoEm, concluidoEm: scans[0].concluidoEm }
      : null,
  }));
}
