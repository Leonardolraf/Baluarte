import { falhar } from '../utils/resposta.js';
import { localizarPorEmail } from '../repositories/usuario.repository.js';
import * as repo from '../repositories/auditoria.repository.js';
import type { FiltrosAuditoria, RegistroAuditoriaDto } from '../models/auditoria.model.js';

// Trilha de auditoria (tabela AuditLog): registra as acoes sensiveis das rotas de
// escrita. Nunca derruba a requisicao — uma falha aqui vira apenas log de erro.
export async function registrarAuditoria(
  usuarioId: string | null,
  acao: string,
  detalhe?: string,
): Promise<void> {
  try {
    await repo.criarRegistro(usuarioId, acao, detalhe ?? null);
  } catch (e) {
    console.error('[auditoria] falha ao registrar', acao, e);
  }
}

/**
 * Consulta da trilha (GET /auditoria, so Administrador): filtros por acao, autor (id ou
 * e-mail) e periodo, paginada no servidor, mais recente primeiro. O autor vem do cadastro
 * atual pelos ids; conta excluida (ou registro sem autor) sai com `usuario: null`.
 */
export async function consultar(f: FiltrosAuditoria) {
  if (f.de && f.ate && f.de > f.ate) falhar(400, 'Período inválido: a data inicial é posterior à final', 'PERIODO_INVALIDO');
  const acoes = await repo.acoesDistintas();
  const resumo = (total: number) => ({ total, pagina: f.pagina, tamanho: f.tamanho, acoes });

  let usuarioId = f.usuarioId;
  if (f.email) {
    const dono = await localizarPorEmail(f.email);
    // E-mail sem conta, ou de outra pessoa que o usuarioId pedido: nenhum registro casa.
    if (!dono || (usuarioId && usuarioId !== dono.id)) return { lista: [] as RegistroAuditoriaDto[], resumo: resumo(0) };
    usuarioId = dono.id;
  }

  const { registros, total } = await repo.consultar({ acao: f.acao, usuarioId, de: f.de, ate: f.ate }, f.pagina, f.tamanho);
  const ids = [...new Set(registros.map((r) => r.usuarioId).filter((id): id is string => id !== null))];
  const autores = new Map((ids.length ? await repo.usuariosPorIds(ids) : []).map((u) => [u.id, u]));
  const lista: RegistroAuditoriaDto[] = registros.map((r) => ({
    id: r.id,
    acao: r.acao,
    detalhe: r.detalhe,
    quando: r.timestamp,
    usuario: (r.usuarioId ? autores.get(r.usuarioId) : undefined) ?? null,
  }));
  return { lista, resumo: resumo(total) };
}
