import type { Asset } from '@prisma/client';
import { host, regra, texto, umDe } from '../utils/esquemas.js';
import { TIPOS_ATIVO } from './dominio.model.js';

// Model de ativo: tipo do dominio, DTO e regras de entrada (zod) do cadastro.

/** Ativo como esta no banco (tabela Asset). */
export type Ativo = Asset;

/** Entrada do cadastro (POST /assets), ja validada no formato. */
export interface CadastroAtivo {
  nome: string;
  tipo: string;
  host: string;
}

export const CADASTRO = [
  regra('nome', texto, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO'),
  regra('tipo', umDe(TIPOS_ATIVO), 'Tipo de ativo inválido', 'TIPO_INVALIDO'),
  regra('host', host, 'Host inválido', 'HOST_INVALIDO'),
];
