import type { Department } from '@prisma/client';
import { z } from 'zod';
import { regra, texto } from '../utils/esquemas.js';

// Model de departamento: tipos do dominio, DTO e regras de entrada (zod) do cadastro.

/** Departamento como esta no banco (modelo Department, campos em ingles por decisao do projeto). */
export type Departamento = Department;

/** Departamento como a API devolve. */
export interface DepartamentoResumo {
  id: string;
  nome: string;
  usuarios: number;
}

/**
 * Resultado de resolver o departamento pelo nome: id, `null` (sem departamento),
 * `undefined` (nao mexer) ou 'invalido'.
 */
export type ResolucaoDepartamento = string | null | undefined | 'invalido';

export const CADASTRO = [
  regra('nome', texto, 'Nome do departamento é obrigatório', 'NOME_OBRIGATORIO'),
  regra('nome', z.string().trim().max(60), 'Nome do departamento deve ter até 60 caracteres', 'NOME_INVALIDO'),
];
