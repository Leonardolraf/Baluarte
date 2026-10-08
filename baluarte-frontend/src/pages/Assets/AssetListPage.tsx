import { Link } from 'react-router-dom';
import type { Asset } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { ASSET_STATUS_CLASS, ASSET_STATUS_LABEL, ASSET_TYPE_LABEL } from '@/lib/severity';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingSpinner,
  PageHeader,
  Skeleton,
  StatCard,
  StatusPill,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { BugIcon, PlusIcon, RefreshIcon, ServerIcon } from '@/components/icons';

function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

function AssetRows({ items }: { items: Asset[] }) {
  return (
    <TBody>
      {items.map((asset) => (
        <Tr key={asset.id}>
          <Td>
            <div className="font-medium text-ink dark:text-white">{asset.name}</div>
            <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{asset.host}</div>
          </Td>
          <Td>{ASSET_TYPE_LABEL[asset.type]}</Td>
          <Td mono className="text-slate-500 dark:text-slate-400">
            {asset.ip ?? '—'}
          </Td>
          <Td>
            <StatusPill
              label={ASSET_STATUS_LABEL[asset.status]}
              colorClass={ASSET_STATUS_CLASS[asset.status]}
            />
          </Td>
          <Td align="right">
            {asset.openFindings > 0 ? (
              // A lista de vulnerabilidades filtra por texto livre: o host leva aos achados do ativo.
              <Link
                to={`/vulnerabilities?q=${encodeURIComponent(asset.host)}`}
                className="inline-flex items-center gap-1 font-semibold tabular-nums text-ink underline-offset-4 hover:underline dark:text-white"
              >
                {formatNumber(asset.openFindings)}
                <BugIcon size={14} />
              </Link>
            ) : (
              <span className="tabular-nums text-slate-500 dark:text-slate-400">0</span>
            )}
          </Td>
          <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
            {asset.lastScanAt ? (
              <time dateTime={asset.lastScanAt} title={formatDateTime(asset.lastScanAt)}>
                {formatRelative(asset.lastScanAt)}
              </time>
            ) : (
              'Nunca'
            )}
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

/** Listagem dos ativos monitorados (destino do indicador "Ativos monitorados" do dashboard). */
export default function AssetListPage() {
  const { data, error, loading, reload } = useAsync<Asset[]>(() => api.listAssets(), []);

  const assets = data ?? [];
  const active = assets.filter((asset) => asset.status === 'active').length;
  const openFindings = assets.reduce((sum, asset) => sum + asset.openFindings, 0);
  const neverScanned = assets.filter((asset) => !asset.lastScanAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ativos monitorados"
        description="Servidores, aplicações, redes e bancos de dados sob varredura."
        actions={
          <>
            <Button
              variant="outline"
              leftIcon={<RefreshIcon size={16} />}
              loading={loading}
              onClick={() => void reload()}
            >
              Atualizar
            </Button>
            <LinkButton to="/assets/new" leftIcon={<PlusIcon size={16} />}>
              Cadastrar ativo
            </LinkButton>
          </>
        }
        meta={
          data ? (
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {plural(active, 'ativo monitorado', 'ativos monitorados')} ·{' '}
              {plural(assets.length, 'cadastrado', 'cadastrados')}
            </span>
          ) : loading ? (
            <Skeleton className="h-5 w-56" />
          ) : null
        }
      />

      {error && !data ? (
        <ErrorState
          status={error.status}
          message={error.message}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : !data ? (
        <LoadingSpinner label="Carregando ativos…" />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={28} />}
          title="Nenhum ativo cadastrado"
          description="Cadastre um ativo para que as varreduras OWASP possam ser executadas."
          action={{ label: 'Cadastrar ativo', to: '/assets/new' }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* Mesma contagem do indicador "Ativos monitorados" do dashboard: só os ativos em operação. */}
            <StatCard label="Monitorados" value={formatNumber(active)} hint="Ativos em operação" />
            <StatCard
              label="Cadastrados"
              value={formatNumber(assets.length)}
              hint={
                assets.length - active > 0
                  ? `Inclui ${formatNumber(assets.length - active)} ${assets.length - active === 1 ? 'inativo' : 'inativos'}`
                  : 'Todos em operação'
              }
            />
            <StatCard
              label="Vulnerabilidades abertas"
              value={formatNumber(openFindings)}
              tone={openFindings > 0 ? 'critical' : 'neutral'}
              href="/vulnerabilities"
            />
            <StatCard
              label="Nunca varridos"
              value={formatNumber(neverScanned)}
              tone={neverScanned > 0 ? 'medium' : 'neutral'}
            />
          </div>

          <Card title="Ativos" subtitle="Inventário sob monitoramento" flush>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Ativo</Th>
                    <Th>Tipo</Th>
                    <Th>IP</Th>
                    <Th>Status</Th>
                    <Th align="right">Achados abertos</Th>
                    <Th>Última varredura</Th>
                  </tr>
                </THead>
                <AssetRows items={assets} />
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
