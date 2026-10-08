import type { Scan } from '@prisma/client';
import { preenchido, regra } from '../utils/esquemas.js';

// Model de varredura: tipo do dominio, estados do ciclo simulado e regra de entrada (zod).

/** Varredura como esta no banco (tabela Scan). */
export type Varredura = Scan;

/** Estados da varredura simulada: EM_FILA -> EM_ANDAMENTO -> CONCLUIDA. */
export type StatusVarredura = 'EM_FILA' | 'EM_ANDAMENTO' | 'CONCLUIDA';

export const INICIO = [regra('ativoId', preenchido, 'ativoId é obrigatório', 'ATIVO_OBRIGATORIO')];
