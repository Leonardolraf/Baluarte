import type { Campaign, CampaignEvent } from '@prisma/client';
import { z } from 'zod';
import { falhar } from '../utils/resposta.js';
import { idRecurso, regra, seVeio, texto, umDe, validar } from '../utils/esquemas.js';
import { TEMPLATES, destinatarioInterno } from './dominio.model.js';

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
  /** `confirmarEnvioTotal: true` no corpo: libera o envio em massa (ver `exigeConfirmacao`). */
  confirmado?: boolean;
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
/** Campo aditivo e opcional do POST /campaigns: ausente ou `true` (booleano). Validado depois do template. */
export const CADASTRO_CONFIRMACAO = [
  regra(
    'confirmarEnvioTotal',
    z.unknown().refine((v) => v === undefined || v === true),
    'confirmarEnvioTotal inválido: envie true (booleano) ou omita o campo',
    'CONFIRMACAO_INVALIDA',
  ),
];

// ---- Trava de envio em massa ------------------------------------------------------
// Um e-mail de phishing simulado em N caixas nao tem volta, e a confirmacao so na tela nao
// segura um POST direto, um script ou um reenvio. Por isso a trava fica no servidor.

/** Limite padrao de destinatarios sem confirmacao explicita. */
export const LIMITE_SEM_CONFIRMACAO_PADRAO = 50;

/**
 * Quantos destinatarios uma campanha pode ter sem `confirmarEnvioTotal: true`: variavel de
 * ambiente CAMPANHA_LIMITE_SEM_CONFIRMACAO (inteiro >= 1), lida a cada chamada; ausente ou
 * invalida, 50.
 */
export function limiteSemConfirmacao(): number {
  const bruto = (process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO ?? '').trim();
  const n = /^\d{1,7}$/.test(bruto) ? Number(bruto) : NaN;
  return n >= 1 ? n : LIMITE_SEM_CONFIRMACAO_PADRAO;
}

/**
 * A regra "cobre todos os elegiveis" so vale a partir deste numero de elegiveis na empresa:
 * abaixo dele, mandar para todos e o caso normal de uma equipe pequena (decisao do Leo em
 * 13/10/2026). O limite de CAMPANHA_LIMITE_SEM_CONFIRMACAO vale sempre.
 */
export const MINIMO_ELEGIVEIS_REGRA_TODOS = 10;

/**
 * A campanha precisa de confirmacao: passa do limite (sempre) ou cobre todos os elegiveis da
 * empresa quando ha pelo menos MINIMO_ELEGIVEIS_REGRA_TODOS deles. Os destinatarios ja passaram
 * pela elegibilidade, entao cobrir todos e ter pelo menos tantos quanto os elegiveis.
 */
export function exigeConfirmacao(destinatarios: number, totalElegiveis: number, limite = limiteSemConfirmacao()): boolean {
  return destinatarios > limite || cobreTodosOsElegiveis(destinatarios, totalElegiveis);
}

/** A lista cobre todos os elegiveis e a empresa tem elegiveis suficientes para a regra valer. */
export function cobreTodosOsElegiveis(destinatarios: number, totalElegiveis: number): boolean {
  return totalElegiveis >= MINIMO_ELEGIVEIS_REGRA_TODOS && destinatarios >= totalElegiveis;
}

// ---- Elegibilidade de destinatario ----------------------------------------------
// Fonte unica da regra "quem pode receber campanha": POST /campaigns (criacao) e
// GET /campanhas/destinatarios (preenchimento do formulario por departamento) usam estas funcoes.

/**
 * Unico status de conta que recebe campanha. Inativo nao recebe; Pendente (convite ainda nao
 * aceito) tambem nao: decisao do Leo em 13/10/2026 (Melhorias #1/#2), so conta ativa vira alvo.
 */
export const STATUS_RECEBE_CAMPANHA = 'Ativo';

/** A conta cadastrada pode receber campanha pelo status. */
export function statusRecebeCampanha(status: string): boolean {
  return status === STATUS_RECEBE_CAMPANHA;
}

/**
 * Regra completa: conta cadastrada, Ativa e com e-mail do dominio interno (ou liberado um a um
 * no DOMINIO_INTERNO, DT19). E a mesma que POST /campaigns aplica, em duas etapas (dominio no
 * controller, 422 DESTINATARIO_EXTERNO; status no service, 422 DESTINATARIO_NAO_CADASTRADO para
 * inexistente ou Inativo e 422 DESTINATARIO_PENDENTE para convite nao aceito).
 */
export function elegivelParaCampanha(u: { email: string; status: string }): boolean {
  return statusRecebeCampanha(u.status) && destinatarioInterno(u.email);
}

/** Destinatario elegivel como GET /campanhas/destinatarios devolve: so o que o formulario precisa. */
export interface DestinatarioElegivel {
  id: string;
  nome: string;
  email: string;
  /** Nome do departamento atual; `null` = sem departamento. */
  departamento: string | null;
}

/** Quantos departamentos um pedido de destinatarios pode trazer. */
export const MAX_DEPARTAMENTOS_FILTRO = 50;

export const CONSULTA_DESTINATARIOS = [
  regra(
    'departamento',
    seVeio(z.union([idRecurso, z.array(idRecurso).min(1).max(MAX_DEPARTAMENTOS_FILTRO)])),
    `Departamento inválido: informe ids de departamento (até ${MAX_DEPARTAMENTOS_FILTRO})`,
    'DEPARTAMENTO_ID_INVALIDO',
  ),
  regra('todos', seVeio(z.literal('1')), 'Parâmetro todos inválido: use todos=1', 'TODOS_INVALIDO'),
];

/**
 * Le o filtro de GET /campanhas/destinatarios: os ids de departamento (sem repeticao) ou
 * `null` para todos (`todos=1`). Os dois juntos ou nenhum dao 400.
 */
export function filtroDestinatarios(query: unknown): string[] | null {
  const q = validar(query, CONSULTA_DESTINATARIOS);
  const bruto = q.departamento;
  const departamentos = [...new Set(Array.isArray(bruto) ? (bruto as string[]) : bruto ? [bruto as string] : [])];
  const todos = q.todos === '1';
  if (todos && departamentos.length)
    falhar(400, 'Use departamento ou todos=1, não os dois', 'FILTRO_CONFLITANTE');
  if (!todos && !departamentos.length)
    falhar(400, 'Informe ao menos um departamento ou todos=1', 'FILTRO_OBRIGATORIO');
  return todos ? null : departamentos;
}
