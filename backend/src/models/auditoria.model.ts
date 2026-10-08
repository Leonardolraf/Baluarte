import type { AuditLog } from '@prisma/client';
import { z } from 'zod';
import { email, regra, regrasDePaginacao, seVeio } from '../utils/esquemas.js';

// Model da trilha de auditoria (tabela AuditLog, RN-008): tipos do dominio, DTOs e as
// regras zod da consulta (GET /api/auditoria). As acoes sao texto livre de proposito: uma
// acao nova (ex.: ANALISAR_ARQUIVO, INSCREVER_ESTACAO) aparece no filtro sem mudar codigo.

/** Registro como esta no banco. Sem FK para User: o registro sobrevive a exclusao da conta. */
export type RegistroAuditoria = AuditLog;

/**
 * Retencao da trilha (RNF-002): registros com mais de 12 meses podem ser apagados por
 * POST /auditoria/retencao. Fixa: a funcao do banco recusa menos que isso.
 */
export const RETENCAO_MESES = 12;

/** Registros lidos por vez ao recalcular a cadeia de hash. */
export const LOTE_VERIFICACAO = 1000;

/**
 * Elo da cadeia como a verificacao le: o hash gravado, o anterior gravado e o `calculado`,
 * recalculado agora pela mesma funcao do banco que o trigger de INSERT usa (fonte unica).
 */
export interface EloCadeia {
  id: string;
  timestamp: Date;
  sequencia: bigint;
  hash: string | null;
  hashAnterior: string | null;
  calculado: string;
}

/**
 * Por que a cadeia quebrou no registro: sem hash (gravado sem o trigger), conteudo que nao
 * bate com o hash (registro alterado) ou `hashAnterior` diferente do hash do registro
 * anterior (registro apagado ou inserido no meio, ou o anterior teve o hash reescrito).
 */
export type MotivoQuebra = 'SEM_HASH' | 'CONTEUDO_ALTERADO' | 'ELO_QUEBRADO';

/** Resultado de GET /auditoria/integridade. */
export interface ResultadoIntegridade {
  integra: boolean;
  registrosVerificados: number;
  /**
   * Triggers da migration 20261008171000_auditoria_imutavel ativos (UPDATE/DELETE/TRUNCATE
   * recusados). Essa migration fica na branch feat/b29-trava; sem ela, `false`.
   */
  travaNoBanco: boolean;
  primeiraQuebra?: { id: string; timestamp: Date; motivo: MotivoQuebra };
}

/** Resultado de POST /auditoria/retencao. */
export interface ResultadoRetencao {
  apagados: number;
  /** Registros anteriores a este instante (UTC) eram elegiveis. */
  corte: Date;
  retencaoMeses: number;
}

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

/** Regras da query de GET /auditoria, na ordem em que sao checadas. */
export const CONSULTA = [
  regra('acao', seVeio(z.string().max(64)), 'Filtro de ação inválido', 'ACAO_INVALIDA'),
  regra('usuarioId', seVeio(z.string().max(64)), 'Filtro de usuário inválido', 'USUARIO_INVALIDO'),
  regra('email', seVeio(email), 'Formato de e-mail inválido', 'EMAIL_INVALIDO'),
  regra('de', seVeio(dataIso), 'Data inicial inválida: use AAAA-MM-DD ou data e hora ISO 8601', 'DATA_INVALIDA'),
  regra('ate', seVeio(dataIso), 'Data final inválida: use AAAA-MM-DD ou data e hora ISO 8601', 'DATA_INVALIDA'),
  ...regrasDePaginacao(TAMANHO_MAXIMO),
];
