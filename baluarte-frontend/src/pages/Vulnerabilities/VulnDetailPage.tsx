import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  VULNERABILITY_STATUSES,
  type Evidence,
  type EvidenceKind,
  type RemediationStep,
  type Vulnerability,
  type VulnerabilityHistoryEntry,
  type VulnerabilityStatus,
} from '@/types';
import { api, FEATURES } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { VULN_STATUS_CLASS, VULN_STATUS_LABEL } from '@/lib/severity';
import { formatCvss, formatDateTime, isHttpUrl } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { notify, trackOperation } from '@/store/uiStore';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  KeyValueList,
  LoadingSpinner,
  PageHeader,
  Select,
  SeverityBadge,
  StatusPill,
  Tabs,
} from '@/components';
import { CopyIcon, ExternalLinkIcon } from '@/components/icons';

const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  request: 'Requisição',
  response: 'Resposta',
  log: 'Log',
  hash: 'Hash',
  screenshot: 'Captura',
  note: 'Nota',
};

const EFFORT_LABEL: Record<RemediationStep['effort'], string> = {
  low: 'Esforço baixo',
  medium: 'Esforço médio',
  high: 'Esforço alto',
};

const HISTORY_ACTION_LABEL: Record<VulnerabilityHistoryEntry['action'], string> = {
  detected: 'Detectada pelo scanner',
  status_changed: 'Status alterado',
  commented: 'Comentário',
  rescanned: 'Nova varredura',
  assigned: 'Atribuída',
};

const NEUTRAL_PILL_CLASS =
  'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30';

const EMPTY = '—';
const STATUS_HINT_ID = 'status-hint';

function Mono({ children, breakAll = false }: { children: ReactNode; breakAll?: boolean }) {
  return <span className={breakAll ? 'break-all font-mono text-xs' : 'font-mono text-xs'}>{children}</span>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="label-caps mb-2">{children}</h3>;
}

function OverviewTab({ vuln }: { vuln: Vulnerability }) {
  const paragraphs = vuln.description
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {paragraph}
          </p>
        ))}
      </div>
      <div>
        <SectionLabel>Referências</SectionLabel>
        {vuln.references.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Sem referências</p>
        ) : (
          <ul className="space-y-1.5">
            {vuln.references.map((url) => (
              <li key={url}>
                {isHttpUrl(url) ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-start gap-1.5 break-all font-mono text-xs text-brand hover:underline dark:text-blue-400"
                  >
                    <span>{url}</span>
                    <ExternalLinkIcon size={12} className="mt-0.5 shrink-0" />
                  </a>
                ) : (
                  // Referência sem esquema http(s) (dado externo do scanner): nunca vira link clicável.
                  <span className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                    {url}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: Evidence }) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill label={EVIDENCE_KIND_LABEL[evidence.kind]} colorClass={NEUTRAL_PILL_CLASS} />
          <span className="truncate text-sm font-medium text-ink dark:text-white">{evidence.label}</span>
        </div>
        <time dateTime={evidence.capturedAt} className="text-xs text-slate-500 dark:text-slate-400">
          {formatDateTime(evidence.capturedAt)}
        </time>
      </header>
      <div className="p-3">
        <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">
          {evidence.content}
        </pre>
      </div>
    </article>
  );
}

function EvidenceTab({ items }: { items: Evidence[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Sem evidências"
        description="Nenhuma evidência foi registrada para este achado."
      />
    );
  }
  return (
    <div className="space-y-4">
      {items.map((evidence) => (
        <EvidenceBlock key={evidence.id} evidence={evidence} />
      ))}
    </div>
  );
}

function RemediationTab({ vuln }: { vuln: Vulnerability }) {
  const steps = [...vuln.remediation].sort((a, b) => a.order - b.order);
  if (steps.length === 0) {
    return (
      <EmptyState
        compact
        title="Sem passos de remediação"
        description="Nenhuma recomendação foi registrada para este achado."
      />
    );
  }
  return (
    <div className="space-y-4">
      {vuln.fixedVersion && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          Versão corrigida disponível: <Mono>{vuln.affectedComponent}</Mono>{' '}
          {vuln.affectedVersion && (
            <>
              <Mono>{vuln.affectedVersion}</Mono> →{' '}
            </>
          )}
          <Mono>{vuln.fixedVersion}</Mono>
        </div>
      )}
      <ol className="space-y-3">
        {steps.map((step) => (
          <li
            key={step.order}
            className="flex gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {step.order}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-ink dark:text-white">
                  <span className="sr-only">Passo {step.order}: </span>
                  {step.title}
                </h3>
                <StatusPill label={EFFORT_LABEL[step.effort]} colorClass={NEUTRAL_PILL_CLASS} />
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HistoryTab({ items }: { items: VulnerabilityHistoryEntry[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Sem histórico"
        description="Nenhum evento foi registrado para este achado."
      />
    );
  }
  const entries = [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <ol className="ml-1.5 border-l border-slate-200 dark:border-slate-800">
      {entries.map((entry) => {
        const transition = [
          entry.from ? VULN_STATUS_LABEL[entry.from] : null,
          entry.to ? VULN_STATUS_LABEL[entry.to] : null,
        ]
          .filter(Boolean)
          .join(' → ');
        return (
          <li key={entry.id} className="relative pb-5 pl-5 last:pb-0">
            <span
              aria-hidden="true"
              className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-400 ring-4 ring-white dark:bg-slate-500 dark:ring-slate-900"
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-ink dark:text-white">
                {HISTORY_ACTION_LABEL[entry.action]}
              </span>
              <time dateTime={entry.at} className="text-xs text-slate-500 dark:text-slate-400">
                {formatDateTime(entry.at)}
              </time>
            </div>
            {transition && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{transition}</p>}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">por {entry.actor}</p>
            {entry.note && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{entry.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function copyToClipboard(text: string, successMessage: string): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    notify.error('A área de transferência não está disponível neste navegador.');
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => notify.success(successMessage))
    .catch(() => notify.error('Não foi possível copiar para a área de transferência.'));
}

export default function VulnDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: vuln, error, loading, reload, setData } = useAsync(() => api.getVulnerability(id), [id]);
  const [pendingStatus, setPendingStatus] = useState<VulnerabilityStatus | null>(null);
  const [saving, setSaving] = useState(false);

  // A rota /vulnerabilities/:id reaproveita a instância: uma escolha de status não enviada
  // não pode "vazar" para outra vulnerabilidade quando o id muda.
  useEffect(() => {
    setPendingStatus(null);
  }, [id]);

  if (!vuln) {
    if (error) {
      if (error.status === 404) {
        return (
          <EmptyState
            tone="error"
            title="Vulnerabilidade não encontrada"
            description="A vulnerabilidade solicitada não existe ou foi removida."
            action={{ label: 'Voltar para vulnerabilidades', to: '/vulnerabilities' }}
            className="min-h-[50vh]"
          />
        );
      }
      // Em 403 o ErrorState já traz "Acesso negado" + "Voltar ao dashboard"; não sobrescrever.
      const forbidden = error.status === 403;
      return (
        <ErrorState
          status={error.status}
          title={forbidden ? undefined : 'Não foi possível carregar a vulnerabilidade'}
          message={forbidden ? undefined : error.message || 'Tente novamente em instantes.'}
          onRetry={() => void reload()}
          retrying={loading}
          className="min-h-[50vh]"
        />
      );
    }
    return <LoadingSpinner label="Carregando vulnerabilidade…" />;
  }

  const selectedStatus = pendingStatus ?? vuln.status;
  const statusUnchanged = selectedStatus === vuln.status;
  // "Risco aceito" some do select quando a API não o suporta (o status corrente nunca é ocultado).
  const statusOptions = FEATURES.riskAcceptance
    ? VULNERABILITY_STATUSES
    : VULNERABILITY_STATUSES.filter((status) => status !== 'accepted' || status === vuln.status);
  const statusHint = FEATURES.riskAcceptance ? null : 'Risco aceito indisponível nesta API';

  const handleStatusSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (statusUnchanged) return;
    setSaving(true);
    try {
      const updated = await trackOperation(api.updateVulnerabilityStatus(vuln.id, selectedStatus));
      setData(updated);
      setPendingStatus(null);
      notify.success('Status atualizado');
    } catch (err) {
      notify.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const summaryItems = [
    {
      label: 'Ativo',
      value: (
        <span className="flex flex-col">
          <span>{vuln.assetName}</span>
          <Mono breakAll>{vuln.assetHost}</Mono>
        </span>
      ),
    },
    { label: 'CVE', value: vuln.cve ? <Mono>{vuln.cve}</Mono> : EMPTY },
    {
      label: 'Categoria OWASP',
      value: (
        <span>
          <Mono>{vuln.owaspId}</Mono> · {vuln.owaspCategory}
        </span>
      ),
    },
    {
      label: 'CVSS v3.1',
      value: (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-base font-semibold tabular-nums">{formatCvss(vuln.cvss.base)}</span>
          <Mono breakAll>{vuln.cvss.vector}</Mono>
        </span>
      ),
    },
    { label: 'Componente afetado', value: <Mono breakAll>{vuln.affectedComponent}</Mono> },
    { label: 'Versão afetada', value: vuln.affectedVersion ? <Mono>{vuln.affectedVersion}</Mono> : EMPTY },
    { label: 'Versão corrigida', value: vuln.fixedVersion ? <Mono>{vuln.fixedVersion}</Mono> : EMPTY },
    {
      label: 'Hash do artefato',
      value: vuln.artifactHash ? (
        <span className="flex items-start gap-1">
          <Mono breakAll>{vuln.artifactHash}</Mono>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Copiar hash"
            title="Copiar hash"
            className="-my-1.5 shrink-0"
            onClick={() => copyToClipboard(vuln.artifactHash ?? '', 'Hash copiado')}
          >
            <CopyIcon size={14} />
          </Button>
        </span>
      ) : (
        EMPTY
      ),
    },
    { label: 'Detectado em', value: formatDateTime(vuln.detectedAt) },
    { label: 'Atualizado em', value: formatDateTime(vuln.updatedAt) },
  ];

  const tabs = [
    { id: 'overview', label: 'Visão geral', content: <OverviewTab vuln={vuln} /> },
    {
      id: 'evidence',
      label: 'Evidências',
      count: vuln.evidence.length,
      content: <EvidenceTab items={vuln.evidence} />,
    },
    {
      id: 'remediation',
      label: 'Remediação',
      count: vuln.remediation.length,
      content: <RemediationTab vuln={vuln} />,
    },
    {
      id: 'history',
      label: 'Histórico',
      count: vuln.history.length,
      content: <HistoryTab items={vuln.history} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Vulnerabilidades', to: '/vulnerabilities' },
          { label: vuln.cve ?? vuln.title },
        ]}
        title={vuln.title}
        description={`${vuln.owaspId} · ${vuln.owaspCategory}`}
        meta={
          <>
            <SeverityBadge severity={vuln.severity} icon size="md" />
            <StatusPill
              label={VULN_STATUS_LABEL[vuln.status]}
              colorClass={VULN_STATUS_CLASS[vuln.status]}
              size="md"
            />
            <span className="font-mono text-sm tabular-nums text-slate-700 dark:text-slate-200">
              CVSS {formatCvss(vuln.cvss.base)}
            </span>
            {vuln.cve && (
              <span className="font-mono text-sm text-slate-700 dark:text-slate-200">{vuln.cve}</span>
            )}
          </>
        }
        actions={
          <form
            onSubmit={(event) => void handleStatusSubmit(event)}
            className="flex flex-wrap items-end gap-2"
          >
            <FormField label="Status" htmlFor="status" className="min-w-[180px]">
              <Select
                id="status"
                name="status"
                value={selectedStatus}
                disabled={saving}
                aria-describedby={statusHint ? STATUS_HINT_ID : undefined}
                onChange={(event) => setPendingStatus(event.target.value as VulnerabilityStatus)}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {VULN_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button type="submit" loading={saving} disabled={statusUnchanged}>
              Atualizar status
            </Button>
            {statusHint && (
              <p id={STATUS_HINT_ID} className="basis-full text-xs text-slate-500 dark:text-slate-400">
                {statusHint}
              </p>
            )}
          </form>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Resumo" className="lg:col-span-1">
          <KeyValueList items={summaryItems} columns={1} />
        </Card>
        <Card className="lg:col-span-2">
          <Tabs items={tabs} aria-label="Detalhes da vulnerabilidade" />
        </Card>
      </div>
    </div>
  );
}
