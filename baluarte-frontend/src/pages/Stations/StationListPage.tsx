import { Link } from 'react-router-dom';
import type { Station, StationListResponse } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { formatWindow, STATION_STATUS_CLASS, STATION_STATUS_DOT, STATION_STATUS_LABEL } from '@/lib/stations';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
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
import { MonitorIcon, RefreshIcon } from '@/components/icons';

function StationRows({ items }: { items: Station[] }) {
  return (
    <TBody>
      {items.map((station) => (
        <Tr key={station.id} data-testid="station-row">
          <Td>
            <Link
              to={`/stations/${encodeURIComponent(station.id)}`}
              className="font-medium text-ink underline-offset-4 hover:underline dark:text-white"
            >
              {station.name}
            </Link>
            <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{station.host}</div>
          </Td>
          <Td>{station.os}</Td>
          <Td>
            <StatusPill
              label={STATION_STATUS_LABEL[station.status]}
              colorClass={STATION_STATUS_CLASS[station.status]}
              dotClass={STATION_STATUS_DOT[station.status]}
            />
          </Td>
          <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
            <time dateTime={station.lastSeenAt} title={formatDateTime(station.lastSeenAt)}>
              {formatRelative(station.lastSeenAt)}
            </time>
          </Td>
          <Td align="right" className="tabular-nums">
            {station.inventoryAt ? formatNumber(station.softwareCount) : '—'}
          </Td>
          <Td align="right" className="tabular-nums">
            {station.inventoryAt ? formatNumber(station.portCount) : '—'}
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

/**
 * Estações de trabalho monitoradas pelo agente osquery (B13): nome da máquina, sistema,
 * último contato e status online/offline, calculado pelo servidor a partir do último
 * contato. O detalhe de cada estação traz os programas instalados e as portas abertas.
 */
export default function StationListPage() {
  const { data, error, loading, reload } = useAsync<StationListResponse>(() => api.listStations(), []);

  const items = data?.items ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estações monitoradas"
        description="Estações de trabalho com o agente osquery: sistema, último contato e inventário."
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
          summary ? (
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {formatNumber(summary.online)} online · {formatNumber(summary.offline)} offline
            </span>
          ) : loading ? (
            <Skeleton className="h-5 w-40" />
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
      ) : !data || !summary ? (
        <LoadingSpinner label="Carregando estações…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MonitorIcon size={28} />}
          title="Nenhuma estação inscrita"
          description="Instale o osquery na estação e aponte-o para o Baluarte: ela aparece aqui depois da inscrição."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Estações" value={formatNumber(summary.total)} hint="Inscritas pelo agente" />
            <StatCard
              label="Online"
              value={formatNumber(summary.online)}
              hint={
                summary.offlineAfterSec > 0
                  ? `Contato nos últimos ${formatWindow(summary.offlineAfterSec)}`
                  : undefined
              }
            />
            <StatCard
              label="Offline"
              value={formatNumber(summary.offline)}
              tone={summary.offline > 0 ? 'medium' : 'neutral'}
              hint={summary.offline > 0 ? 'Sem contato do agente na janela' : 'Todas respondendo'}
            />
          </div>

          <Card title="Estações" subtitle="Por nome da máquina" flush>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Estação</Th>
                    <Th>Sistema operacional</Th>
                    <Th>Status</Th>
                    <Th>Último contato</Th>
                    <Th align="right">Programas</Th>
                    <Th align="right">Portas</Th>
                  </tr>
                </THead>
                <StationRows items={items} />
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
