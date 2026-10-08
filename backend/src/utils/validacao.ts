import { email, host, problemaDaSenha, senhaNova, texto, textoDeQuery } from './esquemas.js';

// Predicados de validacao usados fora das listas de regras (e pelos testes de unidade).
// Todos delegam aos schemas zod de esquemas.ts: uma so fonte de verdade por formato.

export { POLITICA_SENHA } from '../models/dominio.model.js';

/** O "vazio" do contrato: undefined, null ou string vazia. */
export function vazio(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/** Texto obrigatorio: string com conteudo apos o trim (recusa numero, objeto, array). */
export function textoPreenchido(v: unknown): v is string {
  return texto.safeParse(v).success;
}

/** Parametro de query como string; objeto/array (`?q[$ne]=x`) vira undefined. */
export function queryString(v: unknown): string | undefined {
  return textoDeQuery.parse(v);
}

export function emailFormatoValido(v: unknown): boolean {
  return email.safeParse(v).success;
}

export function hostValido(v: unknown): boolean {
  return host.safeParse(v).success;
}

/** Valida uma senha nova contra a politica. Devolve a mensagem do problema ou null. */
export function validarSenha(senha: unknown): string | null {
  return senhaNova.safeParse(senha).success ? null : problemaDaSenha(senha);
}
