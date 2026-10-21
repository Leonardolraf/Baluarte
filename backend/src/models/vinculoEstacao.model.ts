import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { hashToken } from '../utils/tokens.js';
import { msDoAmbiente } from '../utils/ambiente.js';
import { descricaoOpcional, host, idRecurso, ipOpcional, regra, seVeio, texto, type Regra } from '../utils/esquemas.js';

// #9: vinculo de inscricao da estacao. O Administrador emite um codigo no painel; o operador cola
// no instalador; o codigo E o enroll_secret daquela estacao (o osquery nao tem campo livre no
// enroll). No enroll o codigo e consumido (uso unico, TTL 24h) e o ativo-estacao nasce com os
// metadados da emissao. Este model concentra o formato do codigo, a validacao da emissao e a
// regra do estado derivado — nunca fala com o Prisma (isso e do repository).

/** Prefixo que marca um codigo de vinculo: o enroll ramifica por ele (vs. segredo da org). */
export const PREFIXO_CODIGO = 'BLT-';
/**
 * Alfabeto do codigo: 32 caracteres sem os ambiguos (0/O/1/I). O MESMO usado pelo instalador
 * (.Exe) na validacao do wizard — mudar aqui exige mudar la (CodigoValido no .iss, $PadraoCodigo
 * no aplicar.ps1).
 */
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GRUPOS = 3;
const TAMANHO_GRUPO = 4;

/** Regex do codigo canonico (maiusculas, com tracos): BLT-XXXX-XXXX-XXXX. */
const FORMATO_CODIGO = new RegExp(`^BLT-([${ALFABETO_CODIGO}]{${TAMANHO_GRUPO}}-){${GRUPOS - 1}}[${ALFABETO_CODIGO}]{${TAMANHO_GRUPO}}$`);

/** TTL padrao do codigo (24h); sobrescrevivel por VINCULO_TTL_MS (os testes encurtam). */
export const TTL_VINCULO_MS_PADRAO = 24 * 60 * 60 * 1000;
export function ttlVinculoMs(): number {
  return msDoAmbiente('VINCULO_TTL_MS', TTL_VINCULO_MS_PADRAO);
}

/** Gera um codigo canonico aleatorio (randomInt uniforme sobre o alfabeto). */
export function gerarCodigoVinculo(): string {
  const grupo = () =>
    Array.from({ length: TAMANHO_GRUPO }, () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]).join('');
  return PREFIXO_CODIGO + Array.from({ length: GRUPOS }, grupo).join('-');
}

/** Forma canonica do que o agente mandou: sem espacos nas bordas, em maiusculas. */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().toUpperCase();
}

/** O valor recebido tem a cara de um codigo de vinculo (prefixo + formato), ja normalizado. */
export function ehCodigoVinculo(bruto: unknown): boolean {
  return typeof bruto === 'string' && FORMATO_CODIGO.test(normalizarCodigo(bruto));
}

/**
 * Hash (SHA-256 hex) do codigo canonico — o que se grava e o que se procura no banco; o codigo
 * em claro so existe na resposta da emissao. Hash do codigo normalizado (com tracos, maiusculas).
 */
export function codigoHash(codigo: string): string {
  return hashToken(normalizarCodigo(codigo));
}

/** Entrada de POST /estacoes/vinculos; o ativo e sempre "Estação de trabalho" (tipo nao entra). */
export const EMISSAO: Regra[] = [
  regra('nome', texto.pipe(z.string().max(255)), 'Nome da estação inválido', 'NOME_INVALIDO'),
  regra('host', seVeio(host), 'Host inválido', 'HOST_INVALIDO'),
  regra('ip', ipOpcional, 'IP inválido', 'IP_INVALIDO'),
  regra('descricao', descricaoOpcional, 'Descrição inválida', 'DESCRICAO_INVALIDA'),
  regra('usuarioId', seVeio(idRecurso), 'Usuário inválido', 'USUARIO_INVALIDO'),
];

/** Estado derivado do vinculo para o painel (nunca o codigo nem o hash saem). */
export type EstadoVinculo = 'pendente' | 'consumido' | 'expirado';
export function estadoDoVinculo(v: { consumidoEm: Date | null; expiraEm: Date }, agora: Date = new Date()): EstadoVinculo {
  if (v.consumidoEm) return 'consumido';
  return v.expiraEm > agora ? 'pendente' : 'expirado';
}
