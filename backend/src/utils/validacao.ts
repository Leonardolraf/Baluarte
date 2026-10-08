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

/** E-mail canonico: sem espacos nas pontas e em minusculas. */
export function normalizarEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Host de ativo como o usuario costuma colar (B10): com `http://` ou `https://`, tira o
 * esquema, o caminho, a query, o fragmento, a porta e a barra final, e fica so o host
 * ('https://portal.empresa.com:8443/login?x=1' -> 'portal.empresa.com'). Sem esquema, o
 * valor passa igual (so o trim do contrato): 'exemplo.com/rota' continua invalido.
 * Credenciais na URL (`user@host`) nao sao removidas, e o host resultante e recusado.
 */
export function normalizarHost(valor: unknown): unknown {
  if (typeof valor !== 'string') return valor;
  const v = valor.trim();
  const esquema = /^https?:\/\//i.exec(v);
  if (!esquema) return v;
  return v
    .slice(esquema[0].length)
    .split(/[/?#]/, 1)[0]
    .replace(/:\d{1,5}$/, '');
}
