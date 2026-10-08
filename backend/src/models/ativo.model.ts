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
