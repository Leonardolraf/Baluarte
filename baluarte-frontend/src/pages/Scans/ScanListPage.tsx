import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Asset, ScanReport } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { errorMessage } from '@/lib/errors';
import { isScanInProgress, SCAN_STATUS_CLASS, SCAN_STATUS_LABEL } from '@/lib/severity';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  FormField,
  LoadingSpinner,
  PageHeader,
  Select,
  StatusPill,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { ActivityIcon, BugIcon, PlayIcon, RefreshIcon } from '@/components/icons';

/** Intervalo da consulta automática enquanto houver varredura em fila ou em andamento. */
export const SCAN_POLL_MS = 3_000;

function duration(scan: ScanReport): string {
  if (scan.durationSec == null) return '—';
  return scan.durationSec < 60
    ? `${scan.durationSec} s`
    : `${Math.floor(scan.durationSec / 60)} min ${scan.durationSec % 60} s`;
}

function ScanRows({ items }: { items: ScanReport[] }) {
  return (
    <TBody>
      {items.map((scan) => (
        <Tr key={scan.id}>
          <Td>
            <div className="font-medium text-ink dark:text-white">{scan.assetName}</div>
            <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{scan.assetHost}</div>
          </Td>
          <Td>
            <StatusPill label={SCAN_STATUS_LABEL[scan.status]} colorClass={SCAN_STATUS_CLASS[scan.status]} />
          </Td>
          <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
            <time dateTime={scan.startedAt} title={formatDateTime(scan.startedAt)}>
              {formatRelative(scan.startedAt)}
            </time>
          </Td>
          <Td className="tabular-nums text-slate-500 dark:text-slate-400">{duration(scan)}</Td>
          <Td align="right">
            {/* Os achados só existem quando a varredura conclui. */}
            {scan.status !== 'completed' ? (
              <span className="text-slate-500 dark:text-slate-400">—</span>
            ) : scan.findingsCount > 0 && scan.assetHost ? (
              <Link
                to={`/vulnerabilities?q=${encodeURIComponent(scan.assetHost)}`}
                className="inline-flex items-center gap-1 font-semibold tabular-nums text-ink underline-offset-4 hover:underline dark:text-white"
              >
                {formatNumber(scan.findingsCount)}
                <BugIcon size={14} />
              </Link>
            ) : (
              <span className="tabular-nums">{formatNumber(scan.findingsCount)}</span>
            )}
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

/**
 * Varreduras OWASP (simuladas no servidor): iniciar uma varredura por ativo e acompanhar
 * o status (Em fila → Em andamento → Concluída). Enquanto houver varredura em curso, a
 * lista é consultada de novo a cada {@link SCAN_POLL_MS} ms, sem piscar a tela.
 */
export default function ScanListPage() {
  const scansState = useAsync<ScanReport[]>(() => api.listScans(), []);
  const assetsState = useAsync<Asset[]>(() => api.listAssets(), []);
  const { data, error, loading, reload, setData } = scansState;

  const [assetId, setAssetId] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const scans = data ?? [];
  const inProgress = scans.some((scan) => isScanInProgress(scan.status));
  const busyAssets = new Set(scans.filter((s) => isScanInProgress(s.status)).map((s) => s.assetId));
  const activeAssets = (assetsState.data ?? []).filter((asset) => asset.status === 'active');

  // Consulta silenciosa (sem o estado de carregamento) enquanto algo ainda vai mudar de status.
  const polling = useRef(false);
  useEffect(() => {
    if (!inProgress) return undefined;
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      api
        .listScans()
        .then((fresh) => setData(fresh))
        .catch(() => {
          // Falha pontual: a próxima rodada tenta de novo (e o botão Atualizar continua disponível).
        })
        .finally(() => {
          polling.current = false;
        });
    }, SCAN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [inProgress, setData]);

  async function onStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assetId) {
      setStartError('Selecione o ativo a ser varrido.');
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      await api.startScan(assetId);
      setAssetId('');
      setData(await api.listScans());
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Varreduras"
        description="Varreduras OWASP Top 10 por ativo. A execução é simulada no servidor."
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
      />

      <form noValidate onSubmit={(event) => void onStart(event)} aria-busy={starting || undefined}>
        <Card
          title="Nova varredura"
          subtitle="Um ativo só recebe uma nova varredura quando a anterior terminar."
        >
          <div className="space-y-4">
            <FormErrorBanner message={startError} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <FormField label="Ativo" htmlFor="scan-asset" className="sm:w-96">
                <Select
                  id="scan-asset"
                  value={assetId}
                  onChange={(event) => setAssetId(event.target.value)}
                  disabled={starting || !assetsState.data}
                >
                  <option value="">{assetsState.data ? 'Selecione o ativo' : 'Carregando ativos…'}</option>
                  {activeAssets.map((asset) => (
                    <option key={asset.id} value={asset.id} disabled={busyAssets.has(asset.id)}>
                      {asset.name} ({asset.host}){busyAssets.has(asset.id) ? ' · em andamento' : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button type="submit" leftIcon={<PlayIcon size={16} />} loading={starting}>
                Iniciar varredura
              </Button>
            </div>
          </div>
        </Card>
      </form>

      {error && !data ? (
        <ErrorState
          status={error.status}
          message={error.message}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : !data ? (
        <LoadingSpinner label="Carregando varreduras…" />
      ) : scans.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={28} />}
          title="Nenhuma varredura ainda"
          description="Escolha um ativo acima para iniciar a primeira varredura."
        />
      ) : (
        <Card title="Histórico" subtitle="Mais recentes primeiro" flush>
          <p className="px-5 pt-3 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
            {inProgress ? 'Atualizando automaticamente enquanto houver varredura em andamento.' : ''}
          </p>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Ativo</Th>
                  <Th>Status</Th>
                  <Th>Iniciada</Th>
                  <Th>Duração</Th>
                  <Th align="right">Achados</Th>
                </tr>
              </THead>
              <ScanRows items={scans} />
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
