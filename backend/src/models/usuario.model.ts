import type { User } from '@prisma/client';
import { email, opcional, regra, texto, umDe } from '../utils/esquemas.js';
import { PERFIS, STATUS_USUARIO } from './dominio.model.js';

// Model de usuario: tipos do dominio, DTOs e as regras de entrada (zod) do cadastro e da
// edicao, na ordem do contrato.

/** Usuario como esta no banco (tabela User). */
export type Usuario = User;

/** Usuario carregado do banco a cada requisicao autenticada: fonte de verdade para perfil e status. */
export interface UsuarioAtual {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  status: string;
  senhaHash: string;
  senhaAlteradaEm: Date | null;
  sessaoEncerradaEm: Date | null;
  /** Ciencia do aviso de monitoramento na VERSAO_AVISO em vigor (null = pendente). Ver exigeCienciaAviso. */
  cienciaAvisoEm: Date | null;
  departmentId: string | null;
}

/**
 * Resposta de GET /me: so os dados do proprio usuario logado, nenhum dado de recurso.
 * `cienciaAvisoPendente` (aditivo, 19/10/2026) e true quando o usuario nao tem ciencia da
 * VERSAO_AVISO em vigor (nenhuma, ou so de versao antiga). Serve SO para o cliente rotear e
 * explicar (mandar para a tela do aviso); NUNCA decide acesso: a autoridade continua sendo o
 * 403 CIENCIA_AVISO_PENDENTE de exigeCienciaAviso em todas as outras rotas autenticadas.
 */
export interface PerfilProprio {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  status: string;
  departamento: string | null;
  cienciaAvisoPendente: boolean;
}

/** Quem executa a acao (para RBAC fino e auditoria). */
export type Ator = Pick<UsuarioAtual, 'id' | 'perfil'>;

/** Entrada do cadastro (POST /users), ja validada no formato. */
export interface CadastroUsuario {
  nome: string;
  email: string;
  perfil: string;
  departamento: unknown;
}

/** Campos alterados na edicao (PATCH /users/:id); os ausentes nao mudam. */
export type AlteracaoUsuario = { nome?: string; email?: string; perfil?: string; status?: string; departmentId?: string | null };

// ---- Regras de entrada ---------------------------------------------------------

const NOME = regra('nome', texto, 'Nome é obrigatório', 'NOME_OBRIGATORIO');
const EMAIL = regra('email', email, 'Email inválido', 'EMAIL_INVALIDO');
const PERFIL = regra('perfil', umDe(PERFIS), 'Perfil inválido', 'PERFIL_INVALIDO');
export const CADASTRO = [NOME, EMAIL, PERFIL];
export const EDICAO = [opcional(NOME), opcional(EMAIL), opcional(PERFIL), opcional(regra('status', umDe(STATUS_USUARIO), 'Status inválido', 'STATUS_INVALIDO'))];
