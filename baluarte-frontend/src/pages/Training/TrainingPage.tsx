import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Training, TrainingSection } from '@/types';
import { FEATURES, api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { notify, trackOperation } from '@/store/uiStore';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { SEVERITY_BADGE_CLASS, SEVERITY_DOT_CLASS, SEVERITY_TEXT_CLASS } from '@/lib/severity';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icons,
  LinkButton,
  LoadingSpinner,
  PageHeader,
  StatusPill,
} from '@/components';

const { AlertTriangleIcon, ArrowLeftIcon, CheckCircleIcon, CheckIcon, ClockIcon, MailIcon } = Icons;

type IconComponent = typeof AlertTriangleIcon;

/** Pílula neutra: o tipo de ataque é informativo, não uma severidade. */
const NEUTRAL_PILL_CLASS =
  'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30';

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function SectionCard({ section }: { section: TrainingSection }) {
  return (
    <Card as="article" title={section.heading}>
      <div className="space-y-3">
        {splitParagraphs(section.body).map((paragraph, index) => (
          <p key={index} className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {paragraph}
          </p>
        ))}
      </div>
    </Card>
  );
}

function BulletList({
  items,
  icon: Icon,
  iconClass,
}: {
  items: string[];
  icon: IconComponent;
  iconClass: string;
}) {
  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
          <Icon size={16} className={cn('mt-0.5 shrink-0', iconClass)} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function TrainingPage() {
  const { id } = useParams<{ id: string }>();
  const trainingId = id ?? '';
  const { hasRole } = useAuth();
  const {
    data: training,
    error,
    loading,
    reload,
    setData,
  } = useAsync<Training>(() => api.getTraining(trainingId), [trainingId]);
  const [completing, setCompleting] = useState(false);

  if (loading && !training) return <LoadingSpinner label="Carregando treinamento…" />;

  if (error && !training) {
    if (error.status === 404) {
      return (
        <EmptyState
          tone="error"
          title="Treinamento não encontrado"
          description="O treinamento solicitado não existe ou foi removido."
          action={{ label: 'Voltar ao dashboard', to: '/dashboard' }}
          className="min-h-[50vh]"
        />
      );
    }
    return (
      <ErrorState message={error.message} status={error.status} onRetry={() => reload()} retrying={loading} />
    );
  }

  if (!training) return null;

  const progress = training.completed ? 100 : clampProgress(training.progress);
  const canSeeCampaign = hasRole('admin', 'analyst') && !!training.campaignId;

  async function handleComplete() {
    setCompleting(true);
    try {
      const result = await trackOperation(api.completeTraining(trainingId));
      setData(result);
      notify.success('Treinamento concluído!');
    } catch (err) {
      notify.error(errorMessage(err, 'Não foi possível registrar a conclusão do treinamento.'));
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Treinamento' }]}
        title={training.title}
        description={training.summary}
        meta={
          <>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {training.moduleCode}
            </span>
            <StatusPill
              label={training.attackType}
              colorClass={NEUTRAL_PILL_CLASS}
              icon={<MailIcon size={12} />}
            />
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <ClockIcon size={14} />
              {training.durationMin} min
            </span>
            {training.completed && (
              <StatusPill
                label={`Concluído em ${formatDateTime(training.completedAt)}`}
                colorClass={SEVERITY_BADGE_CLASS.low}
                icon={<CheckCircleIcon size={12} />}
              />
            )}
          </>
        }
      />

      <div className="mb-6">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="label-caps">Progresso</span>
          <span className="font-medium tabular-nums text-slate-600 dark:text-slate-300">{progress}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Progresso do treinamento"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              training.completed ? SEVERITY_DOT_CLASS.low : 'bg-ink dark:bg-white',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {training.sections.map((section, index) => (
            <SectionCard key={`${section.heading}-${index}`} section={section} />
          ))}
        </div>

        <aside aria-label="Material de apoio do treinamento" className="space-y-6">
          <Card title="Sinais de alerta" subtitle="O que denuncia uma mensagem maliciosa">
            <BulletList
              items={training.warningSigns}
              icon={AlertTriangleIcon}
              iconClass={SEVERITY_TEXT_CLASS.high}
            />
          </Card>

          <Card title="Boas práticas" subtitle="Como reagir com segurança">
            <BulletList
              items={training.bestPractices}
              icon={CheckCircleIcon}
              iconClass={SEVERITY_TEXT_CLASS.low}
            />
          </Card>

          <Card title="Conclusão">
            <div className="space-y-4">
              {training.completed ? (
                <div
                  role="status"
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-4 py-3 text-sm ring-1 ring-inset',
                    SEVERITY_BADGE_CLASS.low,
                  )}
                >
                  <CheckCircleIcon size={16} className="mt-0.5 shrink-0" />
                  <p>
                    Você concluiu este treinamento em{' '}
                    <span className="font-medium">{formatDateTime(training.completedAt)}</span>. Obrigado por
                    fortalecer a segurança da empresa.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Leia todo o conteúdo e marque como concluído. A conclusão fica registrada no seu histórico
                  e, quando vinculada a uma campanha, entra no relatório de resiliência.
                </p>
              )}

              <div className="flex flex-col gap-3">
                {FEATURES.completeTraining ? (
                  <Button
                    variant="primary"
                    className="w-full"
                    leftIcon={<CheckIcon size={16} />}
                    loading={completing}
                    disabled={training.completed}
                    onClick={handleComplete}
                  >
                    {training.completed ? 'Concluído' : 'Marcar como concluído'}
                  </Button>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Conclusão registrada apenas no ambiente de demonstração
                  </p>
                )}
                {canSeeCampaign ? (
                  <LinkButton
                    to={`/campaigns/${training.campaignId}`}
                    variant="outline"
                    className="w-full"
                    leftIcon={<ArrowLeftIcon size={16} />}
                  >
                    Ver campanha
                  </LinkButton>
                ) : (
                  <LinkButton
                    to="/dashboard"
                    variant="outline"
                    className="w-full"
                    leftIcon={<ArrowLeftIcon size={16} />}
                  >
                    Voltar ao dashboard
                  </LinkButton>
                )}
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
