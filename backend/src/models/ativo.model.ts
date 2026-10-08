import type { Asset } from '@prisma/client';
import { DESCRICAO_MAX, descricaoOpcional, host, ipOpcional, regra, texto, umDe } from '../utils/esquemas.js';
import { TIPOS_ATIVO_CADASTRO } from './dominio.model.js';

// Model de ativo: tipo do dominio, DTO e regras de entrada (zod) do cadastro.

/** Ativo como esta no banco (tabela Asset). */
export type Ativo = Asset;

/** Entrada do cadastro (POST /assets), ja validada no formato. */
export interface CadastroAtivo {
  nome: string;
  tipo: string;
  host: string;
  /** IPv4 opcional (B10). */
  ip: string | null;
  /** Descricao opcional, ate 500 caracteres (B10). */
  descricao: string | null;
}

/**
 * Regras do POST /assets. As tres primeiras sao do contrato N2 AT1 (ordem e erros nao
 * mudam); `ip` e `descricao` sao extensao compativel, validadas depois. O host chega aqui
 * ja normalizado pelo controller (`normalizarHost`: aceita https://host/caminho).
 */
export const CADASTRO = [
  regra('nome', texto, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO'),
  regra('tipo', umDe(TIPOS_ATIVO_CADASTRO), 'Tipo de ativo inválido', 'TIPO_INVALIDO'),
  regra('host', host, 'Host inválido', 'HOST_INVALIDO'),
  regra('ip', ipOpcional, 'Endereço IP inválido', 'IP_INVALIDO'),
  regra('descricao', descricaoOpcional, `A descrição deve ter no máximo ${DESCRICAO_MAX} caracteres`, 'DESCRICAO_INVALIDA'),
];

// ---- Nota de risco do ativo (B25) ------------------------------------------------

/**
 * Peso de cada achado ABERTO na nota de risco do ativo. Cada peso e o piso da faixa CVSS 3.1
 * da severidade (Critico 9,0 arredondado para 10; Alto 7,0; Medio 4,0; Baixo 0,1 arredondado
 * para 1): um achado critico pesa dez baixos.
 */
export const PESO_RISCO: Readonly<Record<string, number>> = { 'Crítico': 10, 'Alto': 7, 'Médio': 4, 'Baixo': 1 };

/** Teto da nota: 100 = dez criticos abertos (ou combinacao de mesmo peso) ou mais. */
export const NOTA_RISCO_MAXIMA = 100;

/** Quantos ativos o dashboard mostra no bloco "ativos de maior risco". */
export const LIMITE_MAIOR_RISCO = 5;

/** Achados abertos de um ativo por severidade (sempre as quatro chaves, inclusive zero). */
export type AbertosPorSeveridade = Record<string, number>;

/** Risco do ativo como a API devolve (GET /assets e o dashboard). */
export interface RiscoAtivo {
  notaRisco: number;
  achadosAbertos: number;
  abertosPorSeveridade: AbertosPorSeveridade;
}
