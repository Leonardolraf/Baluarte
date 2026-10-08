import type { NotificationPreference } from '@prisma/client';
import { z } from 'zod';
import { opcional, regra } from '../utils/esquemas.js';

// Model de preferencias de notificacao: tipos, campos aceitos e regras de entrada (zod).

/** Preferencias como estao no banco (uma linha por usuario). */
export type PreferenciaNotificacao = NotificationPreference;

export const PREF_CAMPOS = ['alertasEmail', 'somenteCriticas', 'resumoSemanal', 'relatoriosCampanha'] as const;
export type PrefCampo = (typeof PREF_CAMPOS)[number];

// Cada preferencia, se enviada, tem de ser booleana.
export const PREFERENCIAS = PREF_CAMPOS.map((campo) =>
  opcional(regra(campo, z.boolean(), `O campo ${campo} deve ser verdadeiro ou falso`, 'PREFERENCIA_INVALIDA')),
);
