import type { AuditLog } from '@prisma/client';
import { z } from 'zod';
import { email, regra } from '../utils/esquemas.js';

// Model da trilha de auditoria (tabela AuditLog, RN-008): tipos do dominio, DTOs e as
// regras zod da consulta (GET /api/auditoria). As acoes sao texto livre de proposito: uma
// acao nova (ex.: ANALISAR_ARQUIVO, INSCREVER_ESTACAO) aparece no filtro sem mudar codigo.

/** Registro como esta no banco. Sem FK para User: o registro sobrevive a exclusao da conta. */
export type RegistroAuditoria = AuditLog;

/** Tamanho padrao e maximo da pagina da consulta. */
export const TAMANHO_PADRAO = 20;
export const TAMANHO_MAXIMO = 100;

/** Filtros ja validados e convertidos (o service so decide, nao interpreta texto). */
export interface FiltrosAuditoria {
  acao?: string;
  usuarioId?: string;
  email?: string;
  de?: Date;
  ate?: Date;
  pagina: number;
  tamanho: number;
}

/** Registro como a API devolve. */
export interface RegistroAuditoriaDto {
  id: string;
  acao: string;
  detalhe: string | null;
  quando: Date;
  usuario: { id: string; nome: string; email: string } | null;
}

// ---- Schemas dos parametros (a query chega como string; objeto/array e recusado) ------

/** Data ISO 8601: `AAAA-MM-DD` ou data e hora (`2026-10-08T12:00:00Z`, com fuso opcional). */
const DATA_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
export const dataIso = z
  .string()
  .regex(DATA_ISO)
  .refine((v) => {
    // Date.parse aceita 30/02 (vira 02/03): confere o dia do calendario a parte.
    const [a, m, d] = v.slice(0, 10).split('-').map(Number);
    const dia = new Date(Date.UTC(a, m - 1, d));
    return dia.getUTCMonth() === m - 1 && dia.getUTCDate() === d && !Number.isNaN(Date.parse(v));
  });

/** Inteiro positivo em texto (sem sinal, sem decimal), dentro do limite dado. */
function inteiroDeQuery(min: number, max: number) {
  return z
    .string()
    .regex(/^\d{1,7}$/)
    .refine((v) => Number(v) >= min && Number(v) <= max);
}

/** Ausente ou vazio (`?acao=`) passa; o resto precisa cumprir o schema do campo. */
function seVeio(esquema: z.ZodType) {
  return z.unknown().refine((v) => v === undefined || v === '' || esquema.safeParse(v).success);
}

/** Regras da query de GET /auditoria, na ordem em que sao checadas. */
export const CONSULTA = [
  regra('acao', seVeio(z.string().max(64)), 'Filtro de ação inválido', 'ACAO_INVALIDA'),
  regra('usuarioId', seVeio(z.string().max(64)), 'Filtro de usuário inválido', 'USUARIO_INVALIDO'),
  regra('email', seVeio(email), 'Formato de e-mail inválido', 'EMAIL_INVALIDO'),
  regra('de', seVeio(dataIso), 'Data inicial inválida: use AAAA-MM-DD ou data e hora ISO 8601', 'DATA_INVALIDA'),
  regra('ate', seVeio(dataIso), 'Data final inválida: use AAAA-MM-DD ou data e hora ISO 8601', 'DATA_INVALIDA'),
  regra('pagina', seVeio(inteiroDeQuery(1, 1_000_000)), 'Página inválida: use um inteiro a partir de 1', 'PAGINA_INVALIDA'),
  regra(
    'tamanho',
    seVeio(inteiroDeQuery(1, TAMANHO_MAXIMO)),
    `Tamanho inválido: use um inteiro de 1 a ${TAMANHO_MAXIMO}`,
    'TAMANHO_INVALIDO',
  ),
];
