import {
  TERMOS_RASCUNHO,
  TEXTO_TERMOS,
  VERSAO_TERMOS,
  VIGENCIA_TERMOS,
  termosAceitos,
  type AceiteTermosDto,
  type TermosDto,
} from '../models/termos.model.js';
import type { UsuarioAtual } from '../models/usuario.model.js';
import * as repo from '../repositories/termos.repository.js';
import { falhar } from '../utils/resposta.js';
import { registrarAuditoria } from './auditoria.service.js';

// Termos de uso (Melhorias #5): o texto em vigor e o aceite de cada conta. Enquanto nao ha
// aceite valido, o middleware exigeTermosAceitos recusa as rotas autenticadas (403
// TERMOS_NAO_ACEITOS), exceto logout, renovacao da sessao e as duas rotas abaixo.

/** GET /conta/termos: texto, versao e se a pessoa ja aceitou os termos em vigor. */
export function termos(usuario: UsuarioAtual): TermosDto {
  const aceito = termosAceitos(usuario.termosAceitosEm);
  return {
    versao: VERSAO_TERMOS,
    rascunho: TERMOS_RASCUNHO,
    texto: TEXTO_TERMOS,
    aceito,
    aceitoEm: aceito ? usuario.termosAceitosEm : null,
  };
}

/**
 * POST /conta/termos/aceite. A versao enviada e a que a pessoa leu: se o texto mudou nesse
 * meio-tempo, 409. Idempotente: com aceite valido, devolve o aceite ja gravado, sem novo
 * registro na auditoria.
 */
export async function aceitar(usuario: UsuarioAtual, versaoLida: string): Promise<AceiteTermosDto> {
  if (versaoLida !== VERSAO_TERMOS)
    falhar(409, 'Os termos mudaram desde a sua leitura: leia a versão atual antes de aceitar', 'VERSAO_DESATUALIZADA');
  const novo = await repo.registrarSeNovo(usuario.id, VIGENCIA_TERMOS);
  const aceitoEm = await repo.buscarAceite(usuario.id);
  // Acabou de ser gravado (ou ja existia); so falta se a conta for excluida no meio.
  if (!aceitoEm) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
  if (novo) await registrarAuditoria(usuario.id, 'ACEITAR_TERMOS', `versao=${VERSAO_TERMOS}`);
  return { versao: VERSAO_TERMOS, aceitoEm, novo };
}
