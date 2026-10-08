import { falhar } from '../utils/resposta.js';
import {
  AVISO_RASCUNHO,
  TEXTO_AVISO,
  VERSAO_AVISO,
  type AvisoDto,
  type CienciaDto,
  type CienciaRegistradaDto,
} from '../models/avisoMonitoramento.model.js';
import { registrarAuditoria } from './auditoria.service.js';
import * as repo from '../repositories/avisoMonitoramento.repository.js';

// Aviso de monitoramento da estacao (B18, RNF-006, LGPD): o texto em vigor e a ciencia de
// cada usuario. A ciencia vale so para a versao lida: texto novo (VERSAO_AVISO nova) pede
// ciencia nova, e a antiga fica guardada como historico.

/** GET /monitoramento/aviso: texto, versao e se o usuario atual ja deu ciencia dela. */
export async function aviso(userId: string): Promise<AvisoDto> {
  const ciencia = await repo.buscarCiencia(userId, VERSAO_AVISO);
  return {
    versao: VERSAO_AVISO,
    rascunho: AVISO_RASCUNHO,
    ...TEXTO_AVISO,
    ciencia: { registrada: !!ciencia, registradaEm: ciencia?.registradaEm ?? null },
  };
}

/**
 * POST /monitoramento/ciencia. A versao enviada e a que a pessoa leu: se o texto mudou nesse
 * meio-tempo, 409 (ela precisa ler o texto novo). Idempotente: a mesma versao de novo devolve
 * a ciencia ja gravada, sem novo registro na auditoria.
 */
export async function registrarCiencia(userId: string, versaoLida: string): Promise<CienciaRegistradaDto> {
  if (versaoLida !== VERSAO_AVISO)
    falhar(
      409,
      'O aviso mudou desde a sua leitura: leia a versão atual antes de registrar a ciência',
      'VERSAO_DESATUALIZADA',
    );
  const nova = await repo.registrarSeNova(userId, VERSAO_AVISO);
  const ciencia = await repo.buscarCiencia(userId, VERSAO_AVISO);
  // A linha acabou de ser gravada (ou ja existia); so falta se a conta for excluida no meio.
  if (!ciencia) falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO');
  if (nova) await registrarAuditoria(userId, 'REGISTRAR_CIENCIA_MONITORAMENTO', `versao=${VERSAO_AVISO}`);
  return { versao: ciencia.versao, registradaEm: ciencia.registradaEm, nova };
}

/** GET /monitoramento/ciencias (Administrador): quem deu ciencia de qual versao, paginado. */
export async function listarCiencias(f: { versao?: string; pagina: number; tamanho: number }) {
  const [{ registros, total }, pendentes] = await Promise.all([
    repo.listar(f.versao, f.pagina, f.tamanho),
    repo.contarAtivosSemCiencia(VERSAO_AVISO),
  ]);
  const lista: CienciaDto[] = registros.map((r) => ({
    id: r.id,
    versao: r.versao,
    registradaEm: r.registradaEm,
    usuario: r.user,
  }));
  return {
    lista,
    resumo: {
      total,
      pagina: f.pagina,
      tamanho: f.tamanho,
      versaoAtual: VERSAO_AVISO,
      /** Contas Ativo sem ciencia da versao em vigor (independe do filtro de versao). */
      pendentesVersaoAtual: pendentes,
    },
  };
}
