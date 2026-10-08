import { z } from 'zod';
import { falhar } from './resposta.js';
import { POLITICA_SENHA } from '../models/dominio.model.js';

// Validacao de entrada com zod, feita pelos controllers (B09).
//
// Cada model declara listas de REGRAS: o campo do corpo, o schema zod que ele precisa
// cumprir e o erro do contrato (status, mensagem, codigo). `validar` aplica as regras NA
// ORDEM declarada e lanca o erro da primeira que falha. A ordem e parte do contrato da
// N2 AT1 (ex.: no login, e-mail vazio -> senha vazia -> formato do e-mail), por isso as
// regras sao uma lista e nao um z.object, que juntaria os erros por campo.

// ---- Schemas de campo ---------------------------------------------------------

/** Presente: nem undefined, nem null, nem string vazia (o "vazio" do contrato). */
export const preenchido = z.unknown().refine((v) => v !== undefined && v !== null && v !== '');

/** Texto com conteudo depois do trim (recusa numero, objeto, array e string em branco). */
export const texto = z.string().trim().min(1);

/** E-mail no formato do contrato; 254 caracteres e o limite pratico (RFC 5321). */
export const email = z.string().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

/** Valor de uma lista fixa do dominio (perfil, tipo de ativo, template, status...). */
export function umDe(lista: readonly string[]) {
  return z.string().refine((v) => lista.includes(v));
}

/** Host de ativo: IPv4 com octetos de 0 a 255 ou nome de dominio (TLD nunca numerico). */
const OCTETO = z.coerce.number().int().min(0).max(255);
function ehIpv4(h: string): boolean {
  const partes = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return !!partes && partes.slice(1).every((o) => OCTETO.safeParse(o).success);
}
export const host = z
  .string()
  .trim()
  .min(1)
  .refine((h) => {
    if (ehIpv4(h)) return true;
    if (/^[\d.]+$/.test(h)) return false;
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h);
  });

/** Ausente no corpo: undefined, null ou string vazia/em branco (campos opcionais). */
function ausente(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** IP opcional do ativo: ausente ou IPv4 com octetos de 0 a 255. */
export const ipOpcional = z.unknown().refine((v) => ausente(v) || (typeof v === 'string' && ehIpv4(v.trim())));

/** Limite da descricao do ativo (o mesmo da restricao CHECK no banco). */
export const DESCRICAO_MAX = 500;

/** Descricao opcional do ativo: ausente ou texto de ate 500 caracteres (apos o trim). */
export const descricaoOpcional = z
  .unknown()
  .refine((v) => ausente(v) || (typeof v === 'string' && v.trim().length <= DESCRICAO_MAX));

/** Senha nova pela politica publicada. A mensagem do erro sai de `problemaDaSenha`. */
export const senhaNova = z
  .string()
  .min(POLITICA_SENHA.comprimentoMinimo)
  .max(POLITICA_SENHA.comprimentoMaximo)
  .refine((s) => !POLITICA_SENHA.exigirMaiusculaMinuscula || (/[a-z]/.test(s) && /[A-Z]/.test(s)))
  .refine((s) => !POLITICA_SENHA.exigirNumeroEspecial || (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)));

/** Mensagem do contrato para a regra de senha que falhou (mesmos textos de antes). */
export function problemaDaSenha(senha: unknown): string {
  if (typeof senha !== 'string' || senha.length < POLITICA_SENHA.comprimentoMinimo)
    return `A nova senha deve ter no mínimo ${POLITICA_SENHA.comprimentoMinimo} caracteres`;
  if (senha.length > POLITICA_SENHA.comprimentoMaximo)
    return `A nova senha deve ter no máximo ${POLITICA_SENHA.comprimentoMaximo} caracteres`;
  if (POLITICA_SENHA.exigirMaiusculaMinuscula && !(/[a-z]/.test(senha) && /[A-Z]/.test(senha)))
    return 'A senha deve conter letras maiúsculas e minúsculas';
  return 'A senha deve conter pelo menos um número e um símbolo';
}

/** Nota CVSS da query string (0.0 a 10.0); `Number()` como antes (aceita "9.8" e ["9.8"]). */
export const notaCvss = z
  .unknown()
  .refine((v) => v !== undefined && v !== '')
  .pipe(z.coerce.number().min(0).max(10));

/** Valor de uma lista fixa sem diferenciar maiusculas (filtro de query: `?severidade=alto`). */
export function umDeSemCaixa(lista: readonly string[]) {
  return z.string().refine((v) => lista.some((item) => item.toLowerCase() === v.trim().toLowerCase()));
}

/** Parametro de query opcional: ausente ou vazio (`?acao=`) passa; o resto cumpre o schema. */
export function seVeio(esquema: z.ZodType) {
  return z.unknown().refine((v) => v === undefined || v === '' || esquema.safeParse(v).success);
}

/** Id de recurso no caminho (cuid do Prisma ou id legivel do seed, ex.: `ativo-001`). */
export const idRecurso = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Parametro de query: so string passa; objeto/array (`?q[$ne]=x`) vira undefined. */
export const textoDeQuery = z.string().optional().catch(undefined);

// ---- Regras e validacao --------------------------------------------------------

export interface Regra {
  campo: string;
  esquema: z.ZodType;
  /** Texto fixo ou calculado a partir do valor recebido. */
  mensagem: string | ((valor: unknown) => string);
  codigo: string;
  status?: number;
}

export function regra(campo: string, esquema: z.ZodType, mensagem: Regra['mensagem'], codigo: string, status = 400): Regra {
  return { campo, esquema, mensagem, codigo, status };
}

/** Campo opcional: so e validado quando veio no corpo (PATCH). */
export function opcional(r: Regra): Regra {
  return { ...r, esquema: r.esquema.optional() };
}

/**
 * Aplica as regras na ordem e devolve o corpo (objeto vazio se nao veio corpo). A primeira
 * regra que falha vira `ErroNegocio`, que o `wrap` da rota devolve no envelope do contrato.
 */
export function validar(entrada: unknown, regras: Regra[]): Record<string, unknown> {
  const corpo = entrada && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {};
  for (const r of regras) {
    const valor = corpo[r.campo];
    if (!r.esquema.safeParse(valor).success)
      falhar(r.status ?? 400, typeof r.mensagem === 'function' ? r.mensagem(valor) : r.mensagem, r.codigo);
  }
  return corpo;
}
