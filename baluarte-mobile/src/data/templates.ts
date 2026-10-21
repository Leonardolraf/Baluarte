import type { EmailTemplate, TemplateId } from '../types';

/** Modelos de e-mail (textos de `src/lib/severity.ts` do produto web). */
export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  {
    id: 'urgency',
    label: 'Urgência',
    description: 'Pressão por ação imediata: "sua conta será bloqueada em 24h".',
    trainingId: 'trn-urgency',
  },
  {
    id: 'authority',
    label: 'Autoridade',
    description: 'Solicitação vinda de um "diretor" ou de "TI": "atualize sua senha agora".',
    trainingId: 'trn-authority',
  },
  {
    id: 'curiosity',
    label: 'Curiosidade',
    description: 'Isca de interesse: "veja o novo plano de cargos e salários".',
    trainingId: 'trn-curiosity',
  },
];

const TEMPLATE_BY_ID = Object.fromEntries(
  EMAIL_TEMPLATES.map((template) => [template.id, template]),
) as Record<TemplateId, EmailTemplate>;

export function getTemplate(id: TemplateId): EmailTemplate {
  return TEMPLATE_BY_ID[id];
}
