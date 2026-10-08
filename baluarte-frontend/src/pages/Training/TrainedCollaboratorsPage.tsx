import { Link } from 'react-router-dom';
import type { TrainingOverview } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/cn';
import { formatNumber, formatPercent } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
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
  // Uma requisição: o servidor consolida (GET /treinamentos/consolidado). Antes a tela
  // pedia o relatório de cada campanha e somava aqui, o que custava 1+N idas à API.
  const { data, error, loading, reload } = useAsync<TrainingOverview>(() => api.getTrainingOverview(), []);

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
