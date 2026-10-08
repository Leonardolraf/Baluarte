import type { Finding } from '@prisma/client';
import { notaCvss, regra, umDe } from '../utils/esquemas.js';
import { STATUS_FINDING } from './dominio.model.js';

// Model de vulnerabilidade (achado de varredura): tipos do dominio, DTOs e regras de entrada (zod).

/** Achado como esta no banco (tabela Finding). */
export type Vulnerabilidade = Finding;

/** Achado com a varredura e o ativo (o ativo e identificado pelo host na API). */
export type FindingComScan = {
  id: string; categoriaOwasp: string; cvss: number; severidade: string; descricao: string; evidencia: string;
  cwe: string | null; cve: string | null; cvssVetor: string | null; remediacao: unknown; status: string; criadoEm: Date;
  scan: { asset: { host: string; nome: string } };
};

/** Filtros da lista (GET /vulnerabilidades); so strings passam. */
export interface FiltrosVulnerabilidade {
  severidade?: string;
  status?: string;
  q?: string;
}

export const CLASSIFICACAO = [regra('cvss', notaCvss, 'CVSS deve estar entre 0.0 e 10.0', 'CVSS_INVALIDO')];
export const ALTERACAO_STATUS = [regra('status', umDe(STATUS_FINDING), 'Status inválido', 'STATUS_INVALIDO')];
