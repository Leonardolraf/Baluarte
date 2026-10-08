import { z } from 'zod';
import { email, preenchido, problemaDaSenha, regra, senhaNova } from '../utils/esquemas.js';

// Model de autenticacao e conta: o payload do JWT, os tipos de link de conta e as
// regras de entrada (zod) das rotas de auth, na ordem do contrato.

/** Payload que vai dentro do JWT. */
export interface TokenPayload {
  idUsuario: string;
  email: string;
  perfil: string;
  /** Inicio da sessao (epoch em segundos): o login original, preservado nas renovacoes. */
  inicioSessao?: number;
  /** Emissao em milissegundos: `iat` so tem segundos e nao separa um logout do login logo antes. */
  emitidoEmMs?: number;
  /** Emissao (epoch em segundos), preenchida pelo jsonwebtoken. */
  iat?: number;
}

/** Link de conta entregue por e-mail: convite (conta nova) ou redefinicao de senha. */
export type TipoLink = 'RESET' | 'CONVITE';

// ---- Regras de entrada ---------------------------------------------------------

export const LOGIN = [
  regra('email', preenchido, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO'),
  regra('senha', preenchido, 'Senha é obrigatória', 'SENHA_OBRIGATORIA'),
  regra('senha', z.string(), 'Senha é obrigatória', 'SENHA_OBRIGATORIA'),
  regra('email', email, 'Formato de e-mail inválido', 'EMAIL_INVALIDO'),
];
export const NOVA_SENHA = [
  regra('novaSenha', preenchido, 'Nova senha é obrigatória', 'NOVA_SENHA_OBRIGATORIA'),
  regra('novaSenha', senhaNova, problemaDaSenha, 'SENHA_FRACA'),
];
export const TROCA_SENHA = [regra('senhaAtual', preenchido, 'Senha atual é obrigatória', 'SENHA_ATUAL_OBRIGATORIA'), ...NOVA_SENHA];
export const TOKEN = regra('token', preenchido, 'Token é obrigatório', 'TOKEN_OBRIGATORIO');
export const CONFIRMACAO_RESET = [TOKEN, ...NOVA_SENHA];
export const VERIFICACAO_LINK = [TOKEN];
export const PEDIDO_RESET = [regra('email', email, 'Formato de e-mail inválido', 'EMAIL_INVALIDO')];
