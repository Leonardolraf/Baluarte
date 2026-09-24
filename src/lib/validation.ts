import type { NewCampaignInput, TemplateId } from '../types';

/**
 * Regras de validação (mesmas mensagens do produto web). Funções puras:
 * recebem o valor e devolvem a mensagem de erro ou `null`.
 */

export const INTERNAL_DOMAIN = '@empresa.com';
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN_LENGTH = 6;
export const CAMPAIGN_NAME_MIN = 3;
export const CAMPAIGN_NAME_MAX = 80;

const RECIPIENT_SEPARATOR = /[\n\r,;]+/;

export const MESSAGES = {
  emailRequired: 'E-mail é obrigatório',
  emailInvalid: 'Formato de e-mail inválido',
  passwordRequired: 'Senha é obrigatória',
  passwordTooShort: `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  nameRequired: 'Informe o nome da campanha.',
  nameTooShort: `O nome deve ter ao menos ${CAMPAIGN_NAME_MIN} caracteres.`,
  nameTooLong: `O nome deve ter no máximo ${CAMPAIGN_NAME_MAX} caracteres.`,
  templateRequired: 'Selecione um modelo.',
  groupRequired: 'Selecione o grupo-alvo.',
  scheduleInvalid: 'Informe uma data e hora válidas.',
  scheduleInPast: 'Informe uma data e hora futuras.',
  recipientsRequired: 'Informe ao menos um destinatário.',
  recipientInvalid: (email: string) => `E-mail inválido: ${email}`,
  recipientExternal: (emails: string) => `Somente destinatários ${INTERNAL_DOMAIN}: ${emails}`,
} as const;

// ---- Login / redefinição -----------------------------------------------------

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return MESSAGES.emailRequired;
  if (!EMAIL_PATTERN.test(email)) return MESSAGES.emailInvalid;
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return MESSAGES.passwordRequired;
  if (value.length < PASSWORD_MIN_LENGTH) return MESSAGES.passwordTooShort;
  return null;
}

// ---- Nova campanha -------------------------------------------------------------

export function validateCampaignName(value: string): string | null {
  const name = value.trim();
  if (!name) return MESSAGES.nameRequired;
  if (name.length < CAMPAIGN_NAME_MIN) return MESSAGES.nameTooShort;
  if (name.length > CAMPAIGN_NAME_MAX) return MESSAGES.nameTooLong;
  return null;
}

export function validateTemplate(value: TemplateId | null): string | null {
  return value ? null : MESSAGES.templateRequired;
}

/** Lista normalizada: separa por linha, vírgula ou ponto e vírgula; minúsculas; sem repetidos. */
export function parseRecipients(raw: string): string[] {
  const emails = raw
    .split(RECIPIENT_SEPARATOR)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(emails));
}

function listSample(items: string[], max = 3): string {
  const shown = items.slice(0, max).join(', ');
  const rest = items.length - max;
  return rest > 0 ? `${shown} (+${rest})` : shown;
}

export interface RecipientsResult {
  emails: string[];
  error: string | null;
}

/** Só aceita e-mails válidos do domínio interno (mesma regra do backend). */
export function validateRecipients(raw: string): RecipientsResult {
  const emails = parseRecipients(raw);
  if (emails.length === 0) return { emails, error: MESSAGES.recipientsRequired };

  const invalid = emails.find((email) => !EMAIL_PATTERN.test(email));
  if (invalid) return { emails, error: MESSAGES.recipientInvalid(invalid) };

  const external = emails.filter((email) => !email.endsWith(INTERNAL_DOMAIN));
  if (external.length > 0) return { emails, error: MESSAGES.recipientExternal(listSample(external)) };

  return { emails, error: null };
}

export interface ScheduleFields {
  day: string;
  month: string;
  hour: string;
  minute: string;
}

export interface ScheduleResult {
  date: Date | null;
  error: string | null;
}

function parseField(value: string, min: number, max: number): number | null {
  const text = value.trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const number = Number(text);
  return number >= min && number <= max ? number : null;
}

/**
 * O ano não é digitado: vale a próxima ocorrência do mês. Mês anterior ao atual
 * é do ano seguinte (em 23/09, "15/01" = 15/01 do ano que vem); o mês atual e os
 * seguintes ficam no ano corrente, então um dia que já passou neste mês continua
 * sendo recusado como data passada (quase sempre é erro de digitação).
 */
export function inferScheduleYear(month: number, now: Date): number {
  const year = now.getFullYear();
  return month - 1 < now.getMonth() ? year + 1 : year;
}

/** Monta a data do disparo e exige que seja válida e futura. */
export function resolveSchedule(fields: ScheduleFields, now: Date): ScheduleResult {
  const day = parseField(fields.day, 1, 31);
  const month = parseField(fields.month, 1, 12);
  const hour = parseField(fields.hour, 0, 23);
  const minute = parseField(fields.minute, 0, 59);
  if (day === null || month === null || hour === null || minute === null) {
    return { date: null, error: MESSAGES.scheduleInvalid };
  }

  const year = inferScheduleYear(month, now);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // 31/02 "vira" 03/03 no construtor de Date: rejeita datas que não existem.
  if (date.getDate() !== day || date.getMonth() !== month - 1) {
    return { date: null, error: MESSAGES.scheduleInvalid };
  }
  if (date.getTime() <= now.getTime()) {
    return { date: null, error: MESSAGES.scheduleInPast };
  }
  return { date, error: null };
}

/** Campos da Nova campanha como o formulário os guarda. */
export interface NewCampaignForm {
  name: string;
  template: TemplateId | null;
  targetGroup: string;
  schedule: ScheduleFields;
  recipients: string;
}

export type NewCampaignField = 'name' | 'template' | 'targetGroup' | 'schedule' | 'recipients';

export type NewCampaignErrors = Partial<Record<NewCampaignField, string>>;

export type NewCampaignValidation =
  | { ok: true; value: NewCampaignInput }
  | { ok: false; errors: NewCampaignErrors };

/** Valida o formulário inteiro de uma vez e devolve os dados prontos para agendar. */
export function validateNewCampaign(form: NewCampaignForm, now: Date): NewCampaignValidation {
  const errors: NewCampaignErrors = {};

  const nameError = validateCampaignName(form.name);
  if (nameError) errors.name = nameError;

  const templateError = validateTemplate(form.template);
  if (templateError) errors.template = templateError;

  if (!form.targetGroup.trim()) errors.targetGroup = MESSAGES.groupRequired;

  const schedule = resolveSchedule(form.schedule, now);
  if (schedule.error) errors.schedule = schedule.error;

  const recipients = validateRecipients(form.recipients);
  if (recipients.error) errors.recipients = recipients.error;

  if (Object.keys(errors).length > 0 || !form.template || !schedule.date) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: form.name.trim(),
      template: form.template,
      targetGroup: form.targetGroup,
      scheduledAt: schedule.date,
      recipients: recipients.emails,
    },
  };
}
