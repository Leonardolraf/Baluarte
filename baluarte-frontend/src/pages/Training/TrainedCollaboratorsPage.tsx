import { Link } from 'react-router-dom';
import type { CampaignReport } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/cn';
import { formatNumber, formatPercent } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  LoadingSpinner,
  PageHeader,
  StatCard,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { GraduationIcon, MouseClickIcon, RefreshIcon, UsersIcon } from '@/components/icons';

interface TrainedCollaborator {
  email: string;
  name: string;
  department: string;
  /** Uma entrada por treinamento concluído (um colaborador pode ser treinado em várias campanhas). */
  campaigns: Array<{ id: string; name: string }>;
}

interface TrainingOverview {
  /** Conclusões pelas métricas da campanha — mesma fonte do indicador do dashboard. */
  completions: number;
  clicked: number;
  /** Clicaram na simulação e ainda não concluíram o treinamento. */
  pendingAfterClick: number;
  /**
   * Quem aparece nominalmente na tabela de status dos destinatários. É uma amostra:
   * as campanhas reportam centenas de destinatários, mas só parte tem linha individual.
   */
  people: TrainedCollaborator[];
  namedCompletions: number;
  byDepartment: Array<{ department: string; completions: number }>;
  campaigns: number;
  /** Campanhas cujo relatório não pôde ser carregado (os números acima as excluem). */
  failed: number;
}

/**
 * Consolida as campanhas: o backend expõe a conclusão de treinamento por campanha
 * (`/campanhas/:id`), não numa lista global de colaboradores. Os totais saem de
 * `metrics` (a mesma fonte do indicador do dashboard); a tabela de destinatários
 * dá os nomes, mas cobre só parte da população.
 */
function consolidar(reports: CampaignReport[], failed: number): TrainingOverview {
  const porPessoa = new Map<string, TrainedCollaborator>();
  const porDepartamento = new Map<string, number>();
  let completions = 0;
  let clicked = 0;
  let namedCompletions = 0;

  for (const report of reports) {
    completions += report.campaign.metrics.trained;
    clicked += report.campaign.metrics.clicked;

    for (const recipient of report.recipients) {
      if (!recipient.trainingCompleted) continue;
      namedCompletions += 1;
      porDepartamento.set(recipient.department, (porDepartamento.get(recipient.department) ?? 0) + 1);

      const chave = recipient.email.toLowerCase();
      const existente = porPessoa.get(chave);
      const campanha = { id: report.campaign.id, name: report.campaign.name };
      if (existente) {
        existente.campaigns.push(campanha);
      } else {
        porPessoa.set(chave, {
          email: recipient.email,
          name: recipient.name,
          department: recipient.department,
          campaigns: [campanha],
        });
      }
    }
  }

  const people = [...porPessoa.values()].sort(
    (a, b) => b.campaigns.length - a.campaigns.length || a.name.localeCompare(b.name, 'pt-BR'),
  );

  return {
    completions,
    clicked,
    pendingAfterClick: Math.max(0, clicked - completions),
    people,
    namedCompletions,
    byDepartment: [...porDepartamento.entries()]
      .map(([department, total]) => ({ department, completions: total }))
      .sort((a, b) => b.completions - a.completions || a.department.localeCompare(b.department, 'pt-BR')),
    campaigns: reports.length,
    failed,
  };
}

/** Barras neutras: conclusão de treinamento é volume, não risco — não recebe cor de severidade. */
function DepartmentBars({ items }: { items: TrainingOverview['byDepartment'] }) {
  const max = Math.max(1, ...items.map((item) => item.completions));
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.department}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{item.department}</span>
            <span className="font-semibold tabular-nums text-ink dark:text-white">
              {formatNumber(item.completions)}
            </span>
          </div>
          <div
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-ink dark:bg-slate-300"
              style={{ width: `${Math.round((item.completions / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Destino do indicador "Colaboradores treinados" do dashboard. */
export default function TrainedCollaboratorsPage() {
  // A conclusão de treinamento vive no relatório de cada campanha: são 1+N requisições.
  // `allSettled` evita que uma campanha indisponível derrube a página inteira — o que
  // falhou é contado e avisado, em vez de zerar o consolidado.
  const { data, error, loading, reload } = useAsync<TrainingOverview>(async () => {
    const campaigns = await api.listCampaigns();
    const settled = await Promise.allSettled(campaigns.map((campaign) => api.getCampaignReport(campaign.id)));
    const reports = settled
      .filter((result): result is PromiseFulfilledResult<CampaignReport> => result.status === 'fulfilled')
      .map((result) => result.value);
    const rejected = settled.find((result) => result.status === 'rejected');
    if (campaigns.length > 0 && reports.length === 0 && rejected?.status === 'rejected') {
      throw rejected.reason;
    }
    return consolidar(reports, settled.length - reports.length);
  }, []);

  if (!data) {
    if (error)
      return (
        <ErrorState
          status={error.status}
          message={error.message}
          onRetry={() => void reload()}
          retrying={loading}
        />
      );
    return <LoadingSpinner label="Carregando treinamentos…" />;
  }

  const coverage = data.clicked > 0 ? (data.completions / data.clicked) * 100 : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colaboradores treinados"
        description="Conclusões do treinamento contextual disparado após as simulações de phishing."
        actions={
          <Button
            variant="outline"
            leftIcon={<RefreshIcon size={16} />}
            loading={loading}
            onClick={() => void reload()}
          >
            Atualizar
          </Button>
        }
        meta={
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {formatNumber(data.campaigns)} {data.campaigns === 1 ? 'campanha' : 'campanhas'} consideradas
          </span>
        }
      />

      {data.failed > 0 && (
        <FormErrorBanner
          message={`${formatNumber(data.failed)} ${data.failed === 1 ? 'campanha não pôde' : 'campanhas não puderam'} ser carregada${data.failed === 1 ? '' : 's'}: os números abaixo excluem esse período. Atualize para tentar de novo.`}
        />
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Treinamentos concluídos"
          value={formatNumber(data.completions)}
          icon={<GraduationIcon size={16} />}
          hint="Total reportado pelas campanhas"
        />
        <StatCard
          label="Identificados por nome"
          value={formatNumber(data.people.length)}
          icon={<UsersIcon size={16} />}
          hint={
            data.namedCompletions < data.completions
              ? `${formatNumber(data.namedCompletions)} de ${formatNumber(data.completions)} conclusões com detalhe individual`
              : 'Pessoas treinadas ao menos uma vez'
          }
        />
        <StatCard
          label="Pendentes após clique"
          value={formatNumber(data.pendingAfterClick)}
          tone={data.pendingAfterClick > 0 ? 'medium' : 'neutral'}
          icon={<MouseClickIcon size={16} />}
          hint="Clicaram e não concluíram"
        />
        <StatCard
          label="Cobertura do treinamento"
          value={coverage === null ? '—' : formatPercent(coverage)}
          hint={coverage === null ? 'Nenhum clique registrado' : 'Concluídos sobre quem clicou'}
        />
      </div>

      {data.people.length === 0 ? (
        <EmptyState
          icon={<GraduationIcon size={28} />}
          title={
            data.completions === 0 ? 'Nenhum treinamento concluído' : 'Sem registro individual disponível'
          }
          description={
            data.completions === 0
              ? 'Quando um colaborador clicar em uma simulação e concluir o treinamento contextual, ele aparece aqui.'
              : `As campanhas reportam ${formatNumber(data.completions)} ${data.completions === 1 ? 'conclusão' : 'conclusões'}, mas nenhuma traz o detalhe por pessoa. O relatório de cada campanha mostra o rastreamento individual.`
          }
          action={{ label: 'Ver campanhas', to: '/campaigns' }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card
            title="Colaboradores"
            subtitle={
              data.namedCompletions < data.completions
                ? `Quem concluiu o treinamento (${formatNumber(data.namedCompletions)} de ${formatNumber(data.completions)} conclusões têm registro individual)`
                : 'Quem concluiu o treinamento'
            }
            flush
            className="lg:col-span-2"
          >
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Colaborador</Th>
                    <Th>Departamento</Th>
                    <Th>Campanhas</Th>
                    <Th align="right">Concluídos</Th>
                  </tr>
                </THead>
                <TBody>
                  {data.people.map((person) => (
                    <Tr key={person.email}>
                      <Td>
                        <div className="font-medium text-ink dark:text-white">{person.name}</div>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {person.email}
                        </div>
                      </Td>
                      <Td>{person.department}</Td>
                      <Td>
                        <ul className="space-y-0.5">
                          {person.campaigns.map((campaign, index) => (
                            <li key={`${campaign.id}-${index}`} className="text-sm">
                              <Link
                                to={`/campaigns/${campaign.id}`}
                                className="text-ink underline-offset-4 hover:underline dark:text-slate-100"
                              >
                                {campaign.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </Td>
                      <Td align="right">
                        <span
                          className={cn(
                            'font-semibold tabular-nums',
                            person.campaigns.length > 1
                              ? 'text-ink dark:text-white'
                              : 'text-slate-600 dark:text-slate-300',
                          )}
                        >
                          {formatNumber(person.campaigns.length)}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>

          <Card title="Conclusões por departamento" subtitle="Com base nos registros individuais">
            <DepartmentBars items={data.byDepartment} />
          </Card>
        </div>
      )}
    </div>
  );
}
