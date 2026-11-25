import { falhar } from '../utils/resposta.js';
import { registrarAuditoria } from './auditoria.service.js';
import { codigoHash, estadoDoVinculo, gerarCodigoVinculo, ttlVinculoMs } from '../models/vinculoEstacao.model.js';
import * as repo from '../repositories/vinculoEstacao.repository.js';

// #9: vinculo de inscricao da estacao. O Administrador emite um codigo de uso unico (painel),
// o operador cola no instalador e o codigo vira o enroll_secret daquela estacao (o consumo no
// enroll fica em agente.service, que chama vinculoEstacao.repository.consumir). Aqui so a emissao,
// a lista do painel e a revogacao. O codigo em claro so existe na resposta da emissao.

function textoOuNulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Emite um codigo de vinculo (so Administrador). Grava a inscricao pendente com os metadados do
 * ativo-estacao e devolve o codigo UMA vez (o banco guarda so o hash). O ativo e sempre do tipo
 * "Estação de trabalho" (o tipo nao entra no corpo). `corpo` ja veio validado por EMISSAO.
 */
export async function emitir(autorId: string, corpo: Record<string, unknown>) {
  const usuarioId = textoOuNulo(corpo.usuarioId);
  if (usuarioId && !(await repo.usuarioExiste(usuarioId))) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');

  const codigo = gerarCodigoVinculo();
  const expiraEm = new Date(Date.now() + ttlVinculoMs());
  const v = await repo.criar({
    codigoHash: codigoHash(codigo),
    nome: String(corpo.nome).trim(),
    host: textoOuNulo(corpo.host),
    ip: textoOuNulo(corpo.ip),
    descricao: textoOuNulo(corpo.descricao),
    usuarioId,
    criadoPorId: autorId,
    expiraEm,
  });
  await registrarAuditoria(autorId, 'EMITIR_VINCULO_ESTACAO', `estação=${v.nome}; vínculo=${v.id}`);
  return { idVinculo: v.id, codigo, expiraEm };
}

/** Lista do painel: estado derivado (pendente/consumido/expirado); nunca o codigo nem o hash. */
export async function listar(pagina: number, tamanho: number) {
  const { linhas, total } = await repo.listar(pagina, tamanho);
  const agora = new Date();
  return {
    lista: linhas.map((v) => ({
      idVinculo: v.id,
      nome: v.nome,
      host: v.host,
      ip: v.ip,
      criadoEm: v.criadoEm,
      expiraEm: v.expiraEm,
      estado: estadoDoVinculo(v, agora),
      assetId: v.assetId,
    })),
    resumo: { total, pagina, tamanho },
  };
}

/** Revoga um vinculo pendente (queima o codigo). 404 inexistente, 409 ja consumido. */
export async function revogar(autorId: string, id: string): Promise<void> {
  const r = await repo.revogar(id);
  if (r === 'nao_encontrado') falhar(404, 'Vínculo não encontrado', 'VINCULO_NAO_ENCONTRADO');
  if (r === 'ja_consumido') falhar(409, 'Vínculo já consumido', 'VINCULO_JA_CONSUMIDO');
  await registrarAuditoria(autorId, 'REVOGAR_VINCULO_ESTACAO', `vínculo=${id}`);
}
