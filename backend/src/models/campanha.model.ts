import type { Campaign, CampaignEvent } from '@prisma/client';
import { regra, texto, umDe } from '../utils/esquemas.js';
import { TEMPLATES } from './dominio.model.js';

// Model de campanha de phishing simulado: tipos do dominio, DTOs e regras de entrada (zod).

/** Campanha como esta no banco (tabela Campaign). */
export type Campanha = Campaign;

/** Evento de um destinatario na campanha (envio, abertura, clique, treino, reporte). */
export type EventoCampanha = CampaignEvent;

/** Datas do funil de um evento (enviado -> aberto -> clicado -> submeteu; reporte a parte). */
export type EventoFunil = { enviadoEm: Date | null; abertoEm: Date | null; clicadoEm: Date | null; submeteuEm: Date | null; reportouEm: Date | null };

/** Entrada da criacao (POST /campaigns), com os destinatarios ja validados no formato e no dominio. */
export interface CadastroCampanha {
  nome: string;
  template: string;
  emails: string[];
}

export interface DestinatarioCampanha {
  nome: string;
  email: string;
  /** Token do link em claro (so existe aqui e no e-mail). */
  token: string;
}

// ---- Regras de entrada ---------------------------------------------------------
// O contrato valida nome -> destinatarios (formato e dominio interno, no controller) -> template.

export const CADASTRO_NOME = [regra('nome', texto, 'Nome da campanha é obrigatório', 'NOME_OBRIGATORIO')];
export const CADASTRO_TEMPLATE = [regra('template', umDe(TEMPLATES), 'Template é obrigatório', 'TEMPLATE_OBRIGATORIO')];
