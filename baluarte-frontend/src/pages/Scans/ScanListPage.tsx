import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Asset, ScanReport } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { errorMessage } from '@/lib/errors';
import { isScanInProgress, SCAN_STATUS_CLASS, SCAN_STATUS_LABEL } from '@/lib/severity';
import { formatDateTime, formatNumber, formatRelative, formatTimeLeft } from '@/lib/format';
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

/** Quantos avisos de "varredura concluída" ficam visíveis (os mais recentes primeiro). */
const MAX_COMPLETION_NOTICES = 3;

function findingsHref(host: string): string {
  return `/vulnerabilities?q=${encodeURIComponent(host)}`;
}

/**
 * Progresso da varredura em curso (B26): etapa, percentual e conclusão prevista, como o
 * servidor calculou na última consulta. Concluída mostra 100%; o resto, travessão.
 */
function ScanProgressCell({ scan }: { scan: ScanReport }) {
  if (!isScanInProgress(scan.status)) {
    return (
      <span className="tabular-nums text-slate-500 dark:text-slate-400">
        {scan.status === 'completed' ? '100%' : '—'}
      </span>
    );
  }
  const timeLeft = formatTimeLeft(scan.estimatedCompletionAt);
  return (
    <div className="min-w-[11rem] space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-ink dark:text-white">{scan.stage}</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">{scan.progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Progresso da varredura de ${scan.assetName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={scan.progress}
        aria-valuetext={`${scan.progress}%, ${scan.stage}`}
        className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-500 motion-reduce:transition-none dark:bg-white"
          style={{ width: `${scan.progress}%` }}
        />
      </div>
      {timeLeft && scan.estimatedCompletionAt ? (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Conclusão prevista em{' '}
          <time dateTime={scan.estimatedCompletionAt} title={formatDateTime(scan.estimatedCompletionAt)}>
            {timeLeft}
          </time>
        </div>
      ) : null}
    </div>
  );
}

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
          <Td>
            <ScanProgressCell scan={scan} />
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
                to={findingsHref(scan.assetHost)}
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
 * o status (Em fila → Em andamento → Concluída) e o progresso (B26). Enquanto houver
 * varredura em curso, cada uma delas é consultada de novo (`GET /scans/:id`) a cada
 * {@link SCAN_POLL_MS} ms, sem piscar a tela; ao concluir, um aviso leva aos achados.
 */
export default function ScanListPage() {
  const scansState = useAsync<ScanReport[]>(() => api.listScans(), []);
  const assetsState = useAsync<Asset[]>(() => api.listAssets(), []);
  const { data, error, loading, reload, setData } = scansState;

  const [assetId, setAssetId] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [completed, setCompleted] = useState<ScanReport[]>([]);

  const scans = data ?? [];
  const running = scans.filter((scan) => isScanInProgress(scan.status));
  const inProgress = running.length > 0;
  const busyAssets = new Set(running.map((s) => s.assetId));
  const activeAssets = (assetsState.data ?? []).filter((asset) => asset.status === 'active');

  // Consulta silenciosa (sem o estado de carregamento) só das varreduras que ainda vão
  // mudar: uma requisição leve por varredura em curso, em vez da lista inteira.
  const runningKey = running.map((s) => s.id).join(',');
  const polling = useRef(false);
  useEffect(() => {
    if (!runningKey) return undefined;
    const ids = runningKey.split(',');
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void Promise.allSettled(ids.map((id) => api.getScan(id)))
        .then((results) => {
          // Falha pontual de uma consulta: a varredura fica como estava e a próxima rodada tenta de novo.
          const fresh = new Map<string, ScanReport>();
          for (const result of results) {
            if (result.status === 'fulfilled') fresh.set(result.value.id, result.value);
          }
          if (fresh.size === 0) return;
          const finished = [...fresh.values()].filter((scan) => scan.status === 'completed');
          if (finished.length > 0) {
            setCompleted((previous) =>
              [...finished, ...previous.filter((p) => !fresh.has(p.id))].slice(0, MAX_COMPLETION_NOTICES),
            );
          }
          setData((previous) => previous?.map((scan) => fresh.get(scan.id) ?? scan) ?? previous);
        })
        .finally(() => {
          polling.current = false;
        });
    }, SCAN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [runningKey, setData]);

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
            {inProgress
              ? 'Atualizando automaticamente enquanto houver varredura em andamento. A varredura continua mesmo se você sair desta tela.'
              : ''}
          </p>
          <div role="status" className="px-5" data-testid="scan-completed-notices">
            {completed.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {completed.map((scan) => (
                  <li
                    key={scan.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-ink ring-1 ring-inset ring-slate-200 dark:bg-slate-800/60 dark:text-white dark:ring-slate-700"
                  >
                    <span>
                      Varredura de <strong className="font-semibold">{scan.assetName}</strong> concluída:{' '}
                      {scan.findingsCount === 0
                        ? 'nenhum achado.'
                        : `${formatNumber(scan.findingsCount)} ${scan.findingsCount === 1 ? 'achado' : 'achados'}.`}
                    </span>
                    {scan.findingsCount > 0 && scan.assetHost ? (
                      <Link
                        to={findingsHref(scan.assetHost)}
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                      >
                        Ver achados
                        <BugIcon size={14} />
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Ativo</Th>
                  <Th>Status</Th>
                  <Th>Progresso</Th>
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
