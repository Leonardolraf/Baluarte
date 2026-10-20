import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAsync } from '@/hooks/useAsync';
import { useNavigate } from 'react-router-dom';
import type { CampaignInput, CampaignTemplate, DepartmentOption, EligibleRecipientsResponse } from '@/types';
import { CAMPAIGN_TEMPLATES } from '@/types';
import { FEATURES, api } from '@/services/api';
import {
  Button,
  Card,
  FormErrorBanner,
  FormField,
  Icons,
  Input,
  PageHeader,
  Textarea,
  describedBy,
} from '@/components';
import { CAMPAIGN_TEMPLATE_DESCRIPTION, CAMPAIGN_TEMPLATE_LABEL } from '@/lib/severity';
import { errorMessage, isHttpError } from '@/lib/errors';
import { toDateTimeLocalValue } from '@/lib/format';
import { notify, trackOperation } from '@/store/uiStore';
import { cn } from '@/lib/cn';
import { INTERNAL_DOMAINS } from '@/lib/domain';

interface CampaignFormValues {
  name: string;
  template: CampaignTemplate | '';
  targetGroup: string;
  scheduledAt: string;
  recipients: string;
}

type CampaignField = keyof CampaignFormValues;

/** Códigos de erro da API que apontam para um campo específico do formulário. */
const FIELD_BY_ERROR_CODE = new Map<string, CampaignField>([
  ['DESTINATARIO_EXTERNO', 'recipients'],
  ['EMAIL_INVALIDO', 'recipients'],
  ['DESTINATARIOS_OBRIGATORIOS', 'recipients'],
  ['MULTIPLOS_DESTINATARIOS', 'recipients'],
  ['AGENDAMENTO_INVALIDO', 'scheduledAt'],
  ['NOME_OBRIGATORIO', 'name'],
  ['TEMPLATE_OBRIGATORIO', 'template'],
  ['GRUPO_OBRIGATORIO', 'targetGroup'],
  // Melhorias #1 e #2: conta que existe mas não aceitou o convite.
  ['DESTINATARIO_PENDENTE', 'recipients'],
]);

/**
 * Melhorias #1 e #2: o grupo-alvo é a seleção de departamentos reais (`GET /departamentos`), num
 * dropdown de múltipla escolha. É um ATALHO para preencher a caixa de destinatários, e opcional:
 * `targetGroup` não faz parte do corpo do POST /campaigns (que leva nome/template/destinatarios),
 * então dá para enviar só digitando um e-mail, sem escolher grupo.
 */
const ALL_LABEL = 'Todos os colaboradores';

/** Mesma regra do backend: somente destinatários do domínio corporativo. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECIPIENT_SEPARATOR_RE = /[\n\r,;]+/;
const ONE_DAY_MS = 86_400_000;
const NAME_MIN = 3;
const NAME_MAX = 80;

// DT20: a tela só mostra os domínios; quem recusa destinatário de fora é a API (DESTINATARIO_EXTERNO).
const INTERNAL_LABEL = INTERNAL_DOMAINS.join(', ');
const RECIPIENTS_HINT = `Um e-mail por linha ou separados por vírgula/ponto e vírgula. Somente internos (${INTERNAL_LABEL}) ou liberados no servidor.`;
const SCHEDULE_HINT = 'A campanha dispara automaticamente na data e hora informadas.';
const TEMPLATE_ERROR_ID = 'template-error';
/** A API real atual aceita um destinatário por campanha (ver `FEATURES.multiRecipientCampaigns`). */
const SINGLE_RECIPIENT_NOTICE = 'Esta API aceita um destinatário por campanha.';
const SINGLE_RECIPIENT_ERROR = 'A API atual aceita apenas um destinatário.';
const RECIPIENTS_PLACEHOLDER = FEATURES.multiRecipientCampaigns
  ? 'ana.souza@empresa.com\nbruno.lima@empresa.com'
  : 'ana.souza@empresa.com';

interface RecipientAnalysis {
  /** Lista normalizada (sem espaços, minúsculas, sem duplicatas). */
  all: string[];
  invalid: string[];
  valid: string[];
}

function isCampaignTemplate(value: string): value is CampaignTemplate {
  return (CAMPAIGN_TEMPLATES as readonly string[]).includes(value);
}

function analyzeRecipients(raw: string): RecipientAnalysis {
  const all = Array.from(
    new Set(
      raw
        .split(RECIPIENT_SEPARATOR_RE)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const invalid = all.filter((email) => !EMAIL_RE.test(email));
  const valid = all.filter((email) => EMAIL_RE.test(email));
  return { all, invalid, valid };
}

function listSample(items: string[], max = 3): string {
  const shown = items.slice(0, max).join(', ');
  const rest = items.length - max;
  return rest > 0 ? `${shown} (+${rest})` : shown;
}

function validateRecipients(raw: string): string | true {
  const { all, invalid } = analyzeRecipients(raw);
  if (all.length === 0) return 'Informe ao menos um destinatário.';
  if (invalid.length > 0) {
    return invalid.length === 1
      ? `E-mail inválido: ${invalid[0]}`
      : `E-mails inválidos: ${listSample(invalid)}`;
  }
  if (!FEATURES.multiRecipientCampaigns && all.length > 1) return SINGLE_RECIPIENT_ERROR;
  return true;
}

function validateSchedule(value: string): string | true {
  if (!value) return 'Informe a data e hora do disparo.';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Informe uma data e hora válidas.';
  if (date.getTime() <= Date.now()) return 'O agendamento deve ser em uma data futura.';
  return true;
}

function recipientsCountLabel(count: number): string {
  return count === 1 ? '1 destinatário válido' : `${count} destinatários válidos`;
}

export default function CampaignFormPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [defaultValues] = useState<CampaignFormValues>(() => ({
    name: '',
    template: '',
    targetGroup: '',
    scheduledAt: toDateTimeLocalValue(new Date(Date.now() + ONE_DAY_MS)),
    recipients: '',
  }));

  const {
    register,
    handleSubmit,
    watch,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CampaignFormValues>({ mode: 'onBlur', defaultValues });

  // Departamentos reais para a seleção (a lista fixa saiu). Falha aqui não trava o
  // formulário: dá para digitar os e-mails à mão, como antes.
  const { data: departments, error: departmentsError } = useAsync<DepartmentOption[]>(
    () => api.listDepartmentOptions(),
    [],
  );
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [allSelected, setAllSelected] = useState(false);
  // Dropdown do grupo-alvo: botão que abre um painel com as opções (multi-seleção por caixas).
  const [deptsOpen, setDeptsOpen] = useState(false);
  const deptsRef = useRef<HTMLDivElement>(null);
  const deptsButtonRef = useRef<HTMLButtonElement>(null);
  const [eligible, setEligible] = useState<EligibleRecipientsResponse | null>(null);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [eligibleError, setEligibleError] = useState<string | null>(null);
  // Confirmação de envio em massa: guarda os valores para reenviar com o campo de confirmação.
  const [massSend, setMassSend] = useState<{ values: CampaignFormValues; total: number } | null>(null);

  const selectedTemplate = watch('template');
  const recipientsRaw = watch('recipients');
  const validRecipients = useMemo(() => analyzeRecipients(recipientsRaw).valid.length, [recipientsRaw]);

  // Marcar departamento (ou "todos") preenche a caixa de destinatários — que segue editável,
  // de propósito: a seleção é um atalho, não uma trava.
  useEffect(() => {
    const semSelecao = !allSelected && selectedDepartments.length === 0;
    if (semSelecao) {
      setEligible(null);
      setEligibleError(null);
      return;
    }
    let cancelado = false;
    setLoadingEligible(true);
    setEligibleError(null);
    api
      .listEligibleRecipients(allSelected ? { all: true } : { departmentIds: selectedDepartments })
      .then((resposta) => {
        if (cancelado) return;
        setEligible(resposta);
        setValue('recipients', resposta.items.map((r) => r.email).join('\n'), {
          shouldValidate: true,
        });
      })
      .catch((erro: unknown) => {
        if (!cancelado) setEligibleError(errorMessage(erro, 'Não foi possível carregar os destinatários.'));
      })
      .finally(() => {
        if (!cancelado) setLoadingEligible(false);
      });
    return () => {
      cancelado = true;
    };
  }, [allSelected, selectedDepartments, setValue]);

  // `targetGroup` descreve a seleção, mas é só rótulo da UI: NÃO vai no corpo do POST /campaigns
  // (o payload é nome/template/destinatarios/confirmado), então o grupo é opcional. Sem nenhum
  // departamento marcado, o rótulo vira "Destinatários individuais" para o cartão otimista não
  // nascer vazio — quem define quem recebe é a caixa de e-mails abaixo.
  const INDIVIDUAL_LABEL = 'Destinatários individuais';
  const targetGroupLabel = useMemo(() => {
    if (allSelected) return ALL_LABEL;
    if (selectedDepartments.length === 0) return INDIVIDUAL_LABEL;
    const nomes = (departments ?? []).filter((d) => selectedDepartments.includes(d.id)).map((d) => d.name);
    return nomes.join(', ');
  }, [allSelected, selectedDepartments, departments]);

  useEffect(() => {
    setValue('targetGroup', targetGroupLabel, { shouldValidate: true });
  }, [targetGroupLabel, setValue]);

  // Fecha o dropdown de departamentos ao clicar fora ou apertar Esc (Esc devolve o foco ao botão).
  useEffect(() => {
    if (!deptsOpen) return;
    const aoClicarFora = (event: MouseEvent) => {
      if (deptsRef.current && !deptsRef.current.contains(event.target as Node)) setDeptsOpen(false);
    };
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDeptsOpen(false);
        deptsButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [deptsOpen]);

  async function enviar(values: CampaignFormValues, confirmMassSend: boolean): Promise<void> {
    if (!isCampaignTemplate(values.template)) return;
    const input: CampaignInput = {
      name: values.name.trim(),
      template: values.template,
      targetGroup: values.targetGroup,
      scheduledAt: new Date(values.scheduledAt).toISOString(),
      recipients: analyzeRecipients(values.recipients).valid,
      // Nunca manda `false`: o contrato pede o campo ausente ou `true`.
      ...(confirmMassSend ? { confirmMassSend: true } : {}),
    };

    try {
      const created = await trackOperation(api.createCampaign(input));
      notify.success('Campanha agendada com sucesso');
      navigate(`/campaigns/${created.id}`);
    } catch (err) {
      // #2: o servidor é quem trava o envio em massa. A tela só pergunta e reenvia.
      if (isHttpError(err) && err.code === 'CONFIRMACAO_ENVIO_EM_MASSA') {
        setMassSend({ values, total: input.recipients.length });
        return;
      }
      const field = isHttpError(err) ? FIELD_BY_ERROR_CODE.get(err.code) : undefined;
      if (field) {
        setError(field, { type: 'server', message: errorMessage(err) }, { shouldFocus: true });
      } else {
        setSubmitError(errorMessage(err));
      }
    }
  }

  async function onSubmit(values: CampaignFormValues): Promise<void> {
    setSubmitError(null);
    setMassSend(null);
    await enviar(values, false);
  }

  const nameError = errors.name?.message;
  const templateError = errors.template?.message;
  const targetGroupError = errors.targetGroup?.message;
  const scheduledAtError = errors.scheduledAt?.message;
  const recipientsError = errors.recipients?.message;

  return (
    <>
      <PageHeader
        title="Nova campanha de phishing"
        description="Agende uma simulação controlada para medir o risco humano e treinar quem clicar."
        breadcrumbs={[{ label: 'Campanhas', to: '/campaigns' }, { label: 'Nova campanha' }]}
      />

      <div className="max-w-2xl space-y-6">
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
          <Icons.InfoIcon
            size={16}
            className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <p>
            Somente destinatários internos (<span className="font-mono text-xs">{INTERNAL_LABEL}</span>) ou
            liberados no servidor. Esta é uma simulação controlada: cada destinatário recebe um e-mail
            identificado como simulação, sem anexos e sem pedido de senha, com o link do treinamento
            (oferecido logo após o clique) e um link para reportar o e-mail suspeito.
          </p>
        </div>

        {!FEATURES.multiRecipientCampaigns && (
          <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
            <Icons.InfoIcon
              size={16}
              className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500"
              aria-hidden="true"
            />
            <p>{SINGLE_RECIPIENT_NOTICE}</p>
          </div>
        )}

        <form noValidate onSubmit={handleSubmit(onSubmit)} aria-busy={isSubmitting || undefined}>
          <Card
            title="Dados da campanha"
            subtitle="Campos marcados com * são obrigatórios."
            footer={
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" loading={isSubmitting} leftIcon={<Icons.CalendarIcon size={16} />}>
                  Agendar campanha
                </Button>
              </div>
            }
          >
            <div className="space-y-5">
              <FormErrorBanner message={submitError} />

              {/*
                #2: a trava do envio em massa é do SERVIDOR (422 CONFIRMACAO_ENVIO_EM_MASSA).
                Esta confirmação não é a proteção — é a explicação antes de reenviar com o
                campo que o servidor exige. Painel em vez de modal: não há diálogo com
                prisão de foco no design system, e um modal feito às pressas é pior que um
                bloco com foco automático.
              */}
              {massSend && (
                <div
                  role="alertdialog"
                  aria-labelledby="confirmar-massa-titulo"
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
                  data-testid="confirmar-envio-massa"
                >
                  <p id="confirmar-massa-titulo" className="font-semibold text-amber-900 dark:text-amber-200">
                    Confirmar envio para {massSend.total} {massSend.total === 1 ? 'pessoa' : 'pessoas'}?
                  </p>
                  <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">
                    É um e-mail de phishing simulado, e não há como cancelar depois do envio.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      autoFocus
                      loading={isSubmitting}
                      onClick={() => {
                        const pendente = massSend;
                        setMassSend(null);
                        void enviar(pendente.values, true);
                      }}
                    >
                      Confirmar e enviar
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setMassSend(null)}>
                      Revisar antes
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  label="Nome da campanha"
                  htmlFor="nome"
                  required
                  error={nameError}
                  className="sm:col-span-2"
                >
                  <Input
                    id="nome"
                    type="text"
                    autoComplete="off"
                    placeholder="Ex.: Simulação Q4 – Financeiro"
                    maxLength={NAME_MAX}
                    invalid={Boolean(nameError)}
                    aria-describedby={describedBy('nome', { error: nameError })}
                    {...register('name', {
                      required: 'Informe o nome da campanha.',
                      validate: (value) => {
                        const length = value.trim().length;
                        if (length < NAME_MIN) return `O nome deve ter ao menos ${NAME_MIN} caracteres.`;
                        if (length > NAME_MAX) return `O nome deve ter no máximo ${NAME_MAX} caracteres.`;
                        return true;
                      },
                    })}
                  />
                </FormField>

                <fieldset
                  className="min-w-0 sm:col-span-2"
                  aria-describedby={templateError ? TEMPLATE_ERROR_ID : undefined}
                >
                  <legend className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Modelo de e-mail
                    <span className="ml-0.5 text-severity-critical" aria-hidden="true">
                      *
                    </span>
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {CAMPAIGN_TEMPLATES.map((template) => {
                      const inputId = `template-${template}`;
                      const selected = selectedTemplate === template;
                      return (
                        <label
                          key={template}
                          htmlFor={inputId}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors',
                            selected
                              ? 'border-ink bg-slate-50 ring-1 ring-ink dark:border-white dark:bg-white/5 dark:ring-white'
                              : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800',
                            templateError && !selected && 'border-severity-critical',
                          )}
                        >
                          <input
                            id={inputId}
                            type="radio"
                            value={template}
                            className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-ink focus:ring-ink dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:ring-white"
                            {...register('template', {
                              validate: (value) => isCampaignTemplate(value) || 'Selecione um modelo.',
                            })}
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-ink dark:text-white">
                              {CAMPAIGN_TEMPLATE_LABEL[template]}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                              {CAMPAIGN_TEMPLATE_DESCRIPTION[template]}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {templateError && (
                    <p
                      id={TEMPLATE_ERROR_ID}
                      role="alert"
                      className="mt-1 text-xs font-medium text-red-700 dark:text-red-300"
                    >
                      {templateError}
                    </p>
                  )}
                </fieldset>

                {/* `targetGroup` é só rótulo da UI (não vai no POST): opcional, sem `required`. */}
                <input type="hidden" {...register('targetGroup')} />

                <fieldset data-testid="grupo-alvo" className="min-w-0">
                  <legend className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Grupo-alvo{' '}
                    <span className="font-normal text-slate-400 dark:text-slate-500">(opcional)</span>
                  </legend>
                  <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                    Atalho para preencher os destinatários por departamento — eles seguem editáveis abaixo.
                    Para mandar a poucas pessoas, deixe sem grupo e digite os e-mails.
                  </p>

                  {departmentsError ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Não foi possível carregar os departamentos. Informe os e-mails à mão abaixo.
                    </p>
                  ) : (
                    <div className="relative" ref={deptsRef}>
                      <button
                        type="button"
                        ref={deptsButtonRef}
                        aria-haspopup="true"
                        aria-expanded={deptsOpen}
                        onClick={() => setDeptsOpen((aberto) => !aberto)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-ink hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-ink dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-white"
                      >
                        <span
                          className={cn(
                            'truncate',
                            !allSelected &&
                              selectedDepartments.length === 0 &&
                              'text-slate-400 dark:text-slate-500',
                          )}
                        >
                          {allSelected
                            ? ALL_LABEL
                            : selectedDepartments.length > 0
                              ? targetGroupLabel
                              : 'Selecionar departamentos'}
                        </span>
                        <Icons.ChevronDownIcon
                          size={16}
                          className={cn('shrink-0 transition-transform', deptsOpen && 'rotate-180')}
                          aria-hidden="true"
                        />
                      </button>

                      {deptsOpen && (
                        <div
                          role="group"
                          aria-label="Departamentos"
                          className="absolute z-10 mt-1 max-h-64 w-full space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                        >
                          <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-slate-50 dark:text-white dark:hover:bg-slate-800">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                              checked={allSelected}
                              onChange={(event) => {
                                setAllSelected(event.target.checked);
                                if (event.target.checked) setSelectedDepartments([]);
                              }}
                            />
                            {ALL_LABEL}
                          </label>

                          {(departments ?? []).map((dep) => (
                            <label
                              key={dep.id}
                              className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-slate-50 dark:text-white dark:hover:bg-slate-800"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                                disabled={allSelected}
                                checked={selectedDepartments.includes(dep.id)}
                                onChange={(event) =>
                                  setSelectedDepartments((atual) =>
                                    event.target.checked
                                      ? [...atual, dep.id]
                                      : atual.filter((id) => id !== dep.id),
                                  )
                                }
                              />
                              <span>{dep.name}</span>
                              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                {dep.users} {dep.users === 1 ? 'pessoa' : 'pessoas'}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {targetGroupError && (
                    <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">
                      {targetGroupError}
                    </p>
                  )}

                  {/* Quem ficou de fora aparece: esconder a exclusão faria a lista parecer completa. */}
                  <p
                    className="mt-2 text-xs text-slate-500 dark:text-slate-400"
                    aria-live="polite"
                    data-testid="resumo-elegiveis"
                  >
                    {loadingEligible
                      ? 'Carregando destinatários…'
                      : eligibleError
                        ? eligibleError
                        : eligible
                          ? `${eligible.items.length} de ${eligible.summary.total} podem receber` +
                            (eligible.summary.pending > 0
                              ? ` · ${eligible.summary.pending} com convite pendente, fora`
                              : '') +
                            (eligible.summary.inactive > 0
                              ? ` · ${eligible.summary.inactive} inativos, fora`
                              : '') +
                            (eligible.summary.outsideDomain > 0
                              ? ` · ${eligible.summary.outsideDomain} fora do domínio interno`
                              : '')
                          : ''}
                  </p>
                </fieldset>

                <FormField
                  label="Agendar para"
                  htmlFor="agendamento"
                  required
                  error={scheduledAtError}
                  hint={SCHEDULE_HINT}
                >
                  <Input
                    id="agendamento"
                    type="datetime-local"
                    min={toDateTimeLocalValue(new Date())}
                    invalid={Boolean(scheduledAtError)}
                    aria-describedby={describedBy('agendamento', {
                      error: scheduledAtError,
                      hint: SCHEDULE_HINT,
                    })}
                    {...register('scheduledAt', { validate: validateSchedule })}
                  />
                </FormField>

                <FormField
                  label="Destinatários"
                  htmlFor="destinatarios"
                  required
                  error={recipientsError}
                  hint={RECIPIENTS_HINT}
                  className="sm:col-span-2"
                >
                  <Textarea
                    id="destinatarios"
                    rows={6}
                    className="font-mono text-xs"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={RECIPIENTS_PLACEHOLDER}
                    invalid={Boolean(recipientsError)}
                    aria-describedby={describedBy('destinatarios', {
                      error: recipientsError,
                      hint: RECIPIENTS_HINT,
                    })}
                    {...register('recipients', { validate: validateRecipients })}
                  />
                  <p
                    className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400"
                    aria-live="polite"
                  >
                    {recipientsCountLabel(validRecipients)}
                  </p>
                </FormField>
              </div>
            </div>
          </Card>
        </form>
      </div>
    </>
  );
}
