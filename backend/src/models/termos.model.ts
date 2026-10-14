import { z } from 'zod';
import { regra } from '../utils/esquemas.js';

// Model dos termos de uso (Melhorias #5): o LUGAR UNICO do texto, a versao dele e as regras
// das rotas /conta/termos. A API serve o texto em GET /conta/termos; o frontend so o exibe.
//
// RASCUNHO: o texto definitivo ainda nao foi escrito nem aprovado (vem do Leo). Ate la, a API
// serve o espaco reservado abaixo com `rascunho: true` e a tela avisa que e provisorio.
//
// Limitacao do schema: o banco guarda so o INSTANTE do aceite (User.termosAceitosEm), nao a
// versao aceita. A regra e "aceitou = data nao nula". Para pedir aceite de novo quando o texto
// mudar sem coluna nova, existe VIGENCIA_TERMOS: preenchida com o instante em que o texto novo
// entrou em vigor, todo aceite anterior a ela deixa de valer e a pessoa aceita outra vez. Ao
// trocar o espaco reservado pelo texto aprovado: TEXTO_TERMOS novo, VERSAO_TERMOS nova,
// TERMOS_RASCUNHO = false e VIGENCIA_TERMOS = instante da publicacao (senao quem aceitou o
// espaco reservado fica como se tivesse aceitado o texto definitivo). O historico de quais
// versoes cada pessoa aceitou fica so na trilha de auditoria (ACEITAR_TERMOS, versao=...).

/** Versao do texto em vigor. Mudou o texto, mudou a versao. */
export const VERSAO_TERMOS = '2026-10-14-rascunho';

/** O texto em vigor ainda nao foi aprovado? */
export const TERMOS_RASCUNHO = true;

/** Texto dos termos de uso (espaco reservado ate a aprovacao). */
export const TEXTO_TERMOS = 'Texto dos termos de uso pendente de aprovação.';

/**
 * Aceites anteriores a este instante nao valem (texto novo exige aceite novo). `null`: vale
 * qualquer aceite registrado.
 */
export const VIGENCIA_TERMOS: Date | null = null;

/** A pessoa ja aceitou os termos em vigor? */
export function termosAceitos(aceitoEm: Date | null | undefined, vigencia: Date | null = VIGENCIA_TERMOS): boolean {
  if (!aceitoEm) return false;
  return !vigencia || aceitoEm.getTime() >= vigencia.getTime();
}

/** GET /conta/termos. */
export interface TermosDto {
  versao: string;
  rascunho: boolean;
  texto: string;
  aceito: boolean;
  /** Instante do aceite em vigor; `null` sem aceite (ou aceite anterior a VIGENCIA_TERMOS). */
  aceitoEm: Date | null;
}

/** POST /conta/termos/aceite. `novo: false` quando o aceite ja existia (idempotente). */
export interface AceiteTermosDto {
  versao: string;
  aceitoEm: Date;
  novo: boolean;
}

/** Formato da versao enviada no aceite. */
export const versaoTermos = z.string().regex(/^[0-9A-Za-z._-]{1,32}$/);

/**
 * POST /conta/termos/aceite { versao }. A versao lida e obrigatoria: quem leu um texto que
 * mudou nesse meio-tempo recebe 409 em vez de aceitar um texto que nao viu.
 */
export const ACEITE = [regra('versao', versaoTermos, 'Versão dos termos inválida', 'VERSAO_INVALIDA')];
