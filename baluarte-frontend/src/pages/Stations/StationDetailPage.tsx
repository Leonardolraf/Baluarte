import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { StationDetail, StationPort, StationSoftware } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import {
  formatWindow,
  listenScope,
  SOFTWARE_SOURCE_LABEL,
  STATION_STATUS_CLASS,
  STATION_STATUS_DOT,
  STATION_STATUS_LABEL,
} from '@/lib/stations';
import {
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  KeyValueList,
  LoadingSpinner,
  PageHeader,
  Pagination,
  StatusPill,
  TBody,
  Table,
  TableEmptyRow,
  Td,
  Th,
  THead,
  Tabs,
  Tr,
} from '@/components';

const EMPTY = '—';
const SOFTWARE_PAGE_SIZE = 25;

function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

function NoInventory() {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      O agente ainda não enviou o inventário. Ele chega na próxima coleta.
    </p>
  );
}

function SoftwareTab({ items, collected }: { items: StationSoftware[]; collected: boolean }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (item) => item.name.toLowerCase().includes(term) || (item.vendor ?? '').toLowerCase().includes(term),
    );
  }, [items, query]);
  const { page, pageSize, total, pageItems, setPage, setPageSize } = usePagination(
    filtered,
    SOFTWARE_PAGE_SIZE,
  );

  if (!collected && items.length === 0) return <NoInventory />;

  return (
    <div className="space-y-4">
      <FormField label="Filtrar programas" htmlFor="software-filter" className="sm:w-80">
        <Input
          id="software-filter"
          type="search"
          value={query}
          placeholder="Nome ou fornecedor"
          onChange={(event) => setQuery(event.target.value)}
        />
      </FormField>
      <div className="-mx-5 overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <Th>Programa</Th>
              <Th>Versão</Th>
              <Th>Fornecedor</Th>
              <Th>Origem</Th>
            </tr>
          </THead>
          <TBody>
            {pageItems.length === 0 ? (
              <TableEmptyRow colSpan={4}>
                {items.length === 0 ? 'Nenhum programa no inventário.' : 'Nenhum programa com esse filtro.'}
              </TableEmptyRow>
            ) : (
              pageItems.map((item) => (
                <Tr key={`${item.source}|${item.name}|${item.version}`} data-testid="software-row">
                  <Td className="font-medium text-ink dark:text-white">{item.name}</Td>
                  <Td mono>{item.version || EMPTY}</Td>
                  <Td>{item.vendor ?? EMPTY}</Td>
                  <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {SOFTWARE_SOURCE_LABEL[item.source]}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </div>
      {total > SOFTWARE_PAGE_SIZE && (
        <Pagination
          className="-mx-5 -mb-5"
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[25, 50, 100]}
        />
      )}
    </div>
  );
}

const SCOPE_LABEL: Record<ReturnType<typeof listenScope>, string> = {
  all: 'Todas as interfaces',
  local: 'Só local',
  specific: 'Interface específica',
};

function PortsTab({ items, collected }: { items: StationPort[]; collected: boolean }) {
  if (!collected && items.length === 0) return <NoInventory />;
  return (
    <div className="-mx-5 overflow-x-auto">
      <Table>
        <THead>
          <tr>
            <Th align="right">Porta</Th>
            <Th>Protocolo</Th>
            <Th>Endereço</Th>
            <Th>Processo</Th>
          </tr>
        </THead>
        <TBody>
          {items.length === 0 ? (
            <TableEmptyRow colSpan={4}>Nenhuma porta em escuta.</TableEmptyRow>
          ) : (
            items.map((item) => (
              <Tr key={`${item.port}/${item.protocol}/${item.address}`} data-testid="port-row">
                <Td align="right" className="font-mono font-semibold tabular-nums text-ink dark:text-white">
                  {item.port}
                </Td>
                <Td>{item.protocol}</Td>
                <Td>
                  <div className="font-mono text-xs">{item.address}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {SCOPE_LABEL[listenScope(item.address)]}
                  </div>
                </Td>
                <Td mono>{item.process ?? EMPTY}</Td>
              </Tr>
            ))
          )}
        </TBody>
      </Table>
    </div>
  );
}

/** Detalhe da estação (B13): resumo, programas instalados e portas abertas do último inventário. */
export default function StationDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: station, error, loading, reload } = useAsync<StationDetail>(() => api.getStation(id), [id]);

  if (!station) {
    if (error) {
      if (error.status === 404) {
        return (
          <EmptyState
            tone="error"
            title="Estação não encontrada"
            description="A estação solicitada não existe ou o endereço está incorreto."
            action={{ label: 'Voltar para estações', to: '/stations' }}
            className="min-h-[50vh]"
          />
        );
      }
      // Em 403 o ErrorState já traz "Acesso negado" + "Voltar ao dashboard"; não sobrescrever.
      const forbidden = error.status === 403;
      return (
        <ErrorState
          status={error.status}
          title={forbidden ? undefined : 'Não foi possível carregar a estação'}
          message={forbidden ? undefined : error.message || 'Tente novamente em instantes.'}
          onRetry={() => void reload()}
          retrying={loading}
          className="min-h-[50vh]"
        />
      );
    }
    return <LoadingSpinner label="Carregando estação…" />;
  }

  const collected = !!station.inventoryAt;
  const summaryItems = [
    { label: 'Host', value: <Mono>{station.host}</Mono> },
    { label: 'Sistema operacional', value: station.os },
    { label: 'Plataforma', value: station.osPlatform ? <Mono>{station.osPlatform}</Mono> : EMPTY },
    { label: 'Build', value: station.osBuild ? <Mono>{station.osBuild}</Mono> : EMPTY },
    {
      label: 'Último contato',
      value: (
        <span className="flex flex-col">
          <span>{formatDateTime(station.lastSeenAt)}</span>
          {station.offlineAfterSec > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Fica offline após {formatWindow(station.offlineAfterSec)} sem contato
            </span>
          )}
        </span>
      ),
    },
    {
      label: 'Último inventário',
      value: collected ? formatDateTime(station.inventoryAt) : 'Aguardando a primeira coleta',
    },
    { label: 'Inscrita em', value: formatDateTime(station.enrolledAt) },
    { label: 'Identificador do agente', value: <Mono>{station.identifier}</Mono> },
  ];

  const tabs = [
    {
      id: 'software',
      label: 'Programas instalados',
      count: station.software.length,
      content: <SoftwareTab items={station.software} collected={collected} />,
    },
    {
      id: 'ports',
      label: 'Portas abertas',
      count: station.ports.length,
      content: <PortsTab items={station.ports} collected={collected} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Estações', to: '/stations' }, { label: station.name }]}
        title={station.name}
        description={station.os}
        meta={
          <>
            <StatusPill
              label={STATION_STATUS_LABEL[station.status]}
              colorClass={STATION_STATUS_CLASS[station.status]}
              dotClass={STATION_STATUS_DOT[station.status]}
              size="md"
            />
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Último contato{' '}
              <time dateTime={station.lastSeenAt} title={formatDateTime(station.lastSeenAt)}>
                {formatRelative(station.lastSeenAt)}
              </time>
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {formatNumber(station.softwareCount)} programas · {formatNumber(station.portCount)} portas
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Resumo" className="lg:col-span-1">
          <KeyValueList items={summaryItems} columns={1} />
        </Card>
        <Card flush className="min-w-0 lg:col-span-2">
          <Tabs
            items={tabs}
            aria-label="Inventário da estação"
            className="[&>[role=tablist]]:px-2 [&>[role=tablist]]:pt-2.5 [&>[role=tabpanel]]:p-5"
          />
        </Card>
      </div>
    </div>
  );
}
