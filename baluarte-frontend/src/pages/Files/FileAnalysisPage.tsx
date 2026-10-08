import { useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type {
  FileScan,
  FileScanFilters,
  FileScanListResponse,
  FileScanOutcome,
  FileScanResult,
  SecondOpinion,
  SecondOpinionStatus,
} from '@/types';
import { api, FILE_SCAN_PAGE_SIZE } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/useAuth';
import { cn } from '@/lib/cn';
import { copyToClipboard } from '@/lib/clipboard';
import {
  CLEAN_VERDICT,
  FILE_TOO_LARGE_MESSAGE,
  fileScanErrorMessage,
  fileScanVerdict,
  formatBytes,
  isTooLarge,
  secondOpinionText,
} from '@/lib/files';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { SEVERITY_BADGE_CLASS } from '@/lib/severity';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  FormField,
  KeyValueList,
  LoadingSpinner,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
  TableEmptyRow,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileScanIcon,
  InfoIcon,
  LockIcon,
  RefreshIcon,
  UploadIcon,
} from '@/components/icons';

type Phase = 'idle' | 'uploading' | 'analyzing';

/** Pílula neutra do veredito sem ameaça: cor é risco, e "sem ameaça conhecida" não é garantia. */
const CLEAN_PILL_CLASS =
  'bg-slate-50 text-slate-700 ring-slate-600/20 dark:bg-slate-800/60 dark:text-slate-200 dark:ring-slate-500/30';

function Sha256({ value }: { value: string }) {
  return (
    <span className="break-all font-mono text-xs">
      {value}
      <Button
        variant="ghost"
        size="sm"
        aria-label="Copiar SHA-256"
        title="Copiar SHA-256"
        className="-my-1.5 ml-1 align-middle"
        onClick={() => copyToClipboard(value, 'SHA-256 copiado')}
      >
        <CopyIcon size={14} />
      </Button>
    </span>
  );
}

function Verdict({ scan }: { scan: FileScan }) {
  if (scan.result === 'threat') {
    return (
      <div
        data-testid="file-verdict"
        data-result="threat"
        className={cn(
          'flex items-start gap-3 rounded-lg px-4 py-4 ring-1 ring-inset',
          SEVERITY_BADGE_CLASS.critical,
        )}
      >
        <AlertTriangleIcon size={22} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-semibold">Ameaça encontrada</p>
          <p className="mt-1 break-all font-mono text-sm font-semibold">
            {scan.threat ?? 'Não identificada'}
          </p>
          <p className="mt-2 text-sm">
            Não abra nem repasse este arquivo. Apague as cópias e avise a equipe de segurança.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid="file-verdict"
      data-result="clean"
      className="flex items-start gap-3 rounded-lg bg-slate-50 px-4 py-4 ring-1 ring-inset ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700"
    >
      <CheckCircleIcon size={22} className="mt-0.5 shrink-0 text-ink dark:text-white" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-ink dark:text-white">{CLEAN_VERDICT}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          O antivírus compara o arquivo com assinaturas de ameaças já catalogadas. Isso não prova que ele é
          confiável: na dúvida, confirme a origem antes de abrir.
        </p>
      </div>
    </div>
  );
}

/** Cor da segunda opinião: risco só quando o VirusTotal detectou algo; o resto é neutro. */
const SECOND_OPINION_CLASS: Record<SecondOpinionStatus, string> = {
  malicious: SEVERITY_BADGE_CLASS.critical,
  suspicious: SEVERITY_BADGE_CLASS.high,
  no_detection: CLEAN_PILL_CLASS,
  unknown: CLEAN_PILL_CLASS,
  unavailable: CLEAN_PILL_CLASS,
  disabled: CLEAN_PILL_CLASS,
};

function VirusTotalLink({ opinion }: { opinion: SecondOpinion }) {
  return (
    <a
      href={opinion.link}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink underline-offset-4 hover:underline dark:text-white"
    >
      Ver relatório do hash no VirusTotal
      <ExternalLinkIcon size={14} className="shrink-0" />
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  );
}

/**
 * Segunda opinião do VirusTotal (B20), abaixo do veredito: só o hash foi consultado, e ela não
 * muda o resultado do antivírus. Desconhecido e indisponível ganham texto próprio.
 */
function SecondOpinionPanel({ opinion }: { opinion: SecondOpinion | null }) {
  if (!opinion) return null;
  const text = secondOpinionText(opinion);
  const detected = opinion.status === 'malicious' || opinion.status === 'suspicious';
  return (
    <div
      data-testid="second-opinion"
      data-status={opinion.status}
      className={cn(
        'rounded-lg px-4 py-3 ring-1 ring-inset',
        detected ? SECOND_OPINION_CLASS[opinion.status] : 'ring-slate-200 dark:ring-slate-700',
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Segunda opinião · VirusTotal
      </p>
      <div className="mt-2 flex items-start gap-2">
        {detected ? (
          <AlertTriangleIcon size={18} className="mt-0.5 shrink-0" />
        ) : (
          <InfoIcon size={18} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
        )}
        <div className="min-w-0 space-y-1">
          <p className={cn('text-sm font-semibold', !detected && 'text-ink dark:text-white')}>{text.title}</p>
          <p className={cn('text-sm', !detected && 'text-slate-600 dark:text-slate-300')}>{text.detail}</p>
          {opinion.checkedAt && (
            <p className={cn('text-xs', !detected && 'text-slate-500 dark:text-slate-400')}>
              Consultado em {formatDateTime(opinion.checkedAt)}
            </p>
          )}
          {opinion.status !== 'disabled' && (
            <div className="pt-1">
              <VirusTotalLink opinion={opinion} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ outcome }: { outcome: FileScanOutcome }) {
  const { scan } = outcome;
  return (
    <Card title="Resultado da análise" subtitle={scan.name}>
      <div className="space-y-5">
        <Verdict scan={scan} />
        <SecondOpinionPanel opinion={scan.secondOpinion} />
        <KeyValueList
          columns={2}
          items={[
            { label: 'Nome', value: <span className="break-all">{scan.name}</span> },
            {
              label: 'Tamanho',
              value: `${formatBytes(scan.size)} (${formatNumber(scan.size)} bytes)`,
            },
            { label: 'Analisado em', value: formatDateTime(scan.scannedAt) },
            { label: 'SHA-256', value: <Sha256 value={scan.sha256} /> },
          ]}
        />
      </div>
    </Card>
  );
}

type ResultFilter = '' | FileScanResult;

const RESULT_FILTER_LABEL: Record<FileScanResult, string> = {
  threat: 'Com ameaça',
  clean: 'Sem ameaça conhecida',
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function ResultFilterBar({
  value,
  onChange,
}: {
  value: ResultFilter;
  onChange: (value: ResultFilter) => void;
}) {
  const id = `${useId()}-result`;
  return (
    <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
      <FormField label="Resultado" htmlFor={id} className="sm:max-w-xs">
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value as ResultFilter)}>
          <option value="">Todos os resultados</option>
          <option value="threat">{RESULT_FILTER_LABEL.threat}</option>
          <option value="clean">{RESULT_FILTER_LABEL.clean}</option>
        </Select>
      </FormField>
    </div>
  );
}

function HistoryTable({
  items,
  showUser,
  emptyRow,
}: {
  items: FileScan[];
  showUser: boolean;
  emptyRow: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <tr>
            <Th>Arquivo</Th>
            <Th>Resultado</Th>
            <Th>VirusTotal</Th>
            <Th>SHA-256</Th>
            {showUser && <Th>Enviado por</Th>}
            <Th>Analisado</Th>
          </tr>
        </THead>
        <TBody>
          {items.length === 0 && <TableEmptyRow colSpan={showUser ? 6 : 5}>{emptyRow}</TableEmptyRow>}
          {items.map((scan) => (
            <Tr key={scan.id} data-testid="file-history-row" data-result={scan.result}>
              <Td>
                <div className="break-all font-medium text-ink dark:text-white">{scan.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(scan.size)}</div>
              </Td>
              <Td>
                {scan.result === 'threat' ? (
                  <StatusPill
                    label={`Ameaça: ${scan.threat ?? 'não identificada'}`}
                    colorClass={SEVERITY_BADGE_CLASS.critical}
                    icon={<AlertTriangleIcon size={12} />}
                  />
                ) : (
                  <StatusPill label="Sem ameaça conhecida" colorClass={CLEAN_PILL_CLASS} />
                )}
              </Td>
              <Td>
                {scan.secondOpinion ? (
                  <StatusPill
                    label={secondOpinionText(scan.secondOpinion).short}
                    title={secondOpinionText(scan.secondOpinion).title}
                    colorClass={SECOND_OPINION_CLASS[scan.secondOpinion.status]}
                  />
                ) : (
                  <span
                    className="text-slate-500 dark:text-slate-400"
                    title="Análise anterior à segunda opinião"
                  >
                    —
                  </span>
                )}
              </Td>
              <Td>
                <span className="font-mono text-xs text-slate-600 dark:text-slate-300" title={scan.sha256}>
                  {scan.sha256.slice(0, 12)}…
                </span>
              </Td>
              {showUser && (
                <Td>
                  {scan.uploadedBy ? (
                    <>
                      <div className="text-ink dark:text-white">{scan.uploadedBy.name}</div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {scan.uploadedBy.email}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">—</span>
                  )}
                </Td>
              )}
              <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
                <time dateTime={scan.scannedAt} title={formatDateTime(scan.scannedAt)}>
                  {formatRelative(scan.scannedAt)}
                </time>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/**
 * Análise de arquivos (B05): o usuário envia um arquivo, o servidor o passa pelo antivírus
 * (ClamAV, B04), responde o veredito e descarta o arquivo — só o hash e o resultado ficam
 * no histórico. Aberta aos três perfis; operadores veem quem enviou cada análise.
 */
export default function FileAnalysisPage() {
  const { hasRole } = useAuth();
  const operator = hasRole('admin', 'analyst');
  // B17: filtro por resultado e paginação vão para o servidor (o histórico não vem inteiro).
  const [resultFilter, setResultFilter] = useState<ResultFilter>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FILE_SCAN_PAGE_SIZE);
  const query = useMemo<FileScanFilters>(
    () => ({ result: resultFilter || undefined, page, pageSize }),
    [resultFilter, page, pageSize],
  );
  const queryKey = JSON.stringify(query);
  const { data, error, loading, reload, setData } = useAsync<FileScanListResponse>(
    () => api.listFileScans(query),
    [queryKey],
    { keepPreviousData: true },
  );

  // Filtro novo ou tamanho novo: volta para a primeira página.
  const changeResultFilter = (next: ResultFilter) => {
    setResultFilter(next);
    setPage(1);
  };
  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState<{ name: string; size: number } | null>(null);
  const [outcome, setOutcome] = useState<FileScanOutcome | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const busy = phase !== 'idle';

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  async function analyze(file: File) {
    if (busy) return;
    setOutcome(null);
    setUploadError(null);
    setCurrent({ name: file.name, size: file.size });
    if (isTooLarge(file.size)) {
      setUploadError(`${FILE_TOO_LARGE_MESSAGE} "${file.name}" tem ${formatBytes(file.size)}.`);
      return;
    }
    setPhase('uploading');
    setProgress(0);
    try {
      const result = await api.analyzeFile(file, {
        onProgress: (percent) => {
          setProgress(percent);
          if (percent >= 100) setPhase('analyzing');
        },
      });
      setOutcome(result);
      // A análise nova é a mais recente: aparece no topo da primeira página (se passar no filtro).
      if (page !== 1) {
        setPage(1);
      } else {
        try {
          setData(await api.listFileScans(query));
        } catch {
          // Lista indisponível agora: a análise nova entra no topo do que já estava na tela.
          if (!resultFilter || result.scan.result === resultFilter) {
            setData((previous) => ({
              items: [result.scan, ...(previous?.items ?? [])].slice(0, pageSize),
              total: (previous?.total ?? 0) + 1,
              page: 1,
              pageSize,
            }));
          }
        }
      }
    } catch (err) {
      setUploadError(fileScanErrorMessage(err));
    } finally {
      setPhase('idle');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!busy) setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void analyze(file);
  }

  const announcement = busy
    ? phase === 'uploading'
      ? `Enviando ${current?.name ?? 'arquivo'}…`
      : `Analisando ${current?.name ?? 'arquivo'}…`
    : outcome
      ? `${fileScanVerdict(outcome.scan)}. Arquivo ${outcome.scan.name}.${
          outcome.scan.secondOpinion
            ? ` VirusTotal: ${secondOpinionText(outcome.scan.secondOpinion).title}.`
            : ''
        }`
      : '';

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const filterLabel = resultFilter ? RESULT_FILTER_LABEL[resultFilter].toLowerCase() : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análise de arquivos"
        description="Confira um arquivo recebido contra as assinaturas de ameaças conhecidas do antivírus antes de abri-lo."
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

      <Card title="Enviar arquivo" subtitle="Um arquivo por vez, até 10 MB.">
        <div className="space-y-4">
          <p
            id="file-privacy"
            className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"
            data-testid="file-privacy"
          >
            <LockIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              O arquivo é analisado e descartado em seguida: ele não fica guardado. Só o hash (SHA-256) e o
              resultado ficam no histórico. Para a segunda opinião, só o hash é consultado no VirusTotal: o
              arquivo nunca é enviado a ele.
            </span>
          </p>

          <div
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy || undefined}
            aria-label="Escolher arquivo para análise. Você também pode arrastar e soltar um arquivo aqui."
            aria-describedby="file-drop-hint file-privacy"
            data-testid="file-dropzone"
            data-dragging={dragging || undefined}
            onClick={openPicker}
            onKeyDown={onKeyDown}
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-5 py-10 text-center transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 dark:focus-visible:ring-white dark:focus-visible:ring-offset-slate-900',
              dragging
                ? 'border-ink bg-slate-100 dark:border-white dark:bg-slate-800'
                : 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500',
              busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
            )}
          >
            <UploadIcon size={28} className="text-slate-500 dark:text-slate-400" />
            <p className="text-sm font-medium text-ink dark:text-white">
              {dragging ? 'Solte para analisar' : 'Arraste e solte um arquivo aqui'}
            </p>
            <span className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white dark:bg-white dark:text-ink">
              Escolher arquivo
            </span>
            <p id="file-drop-hint" className="text-xs text-slate-500 dark:text-slate-400">
              Qualquer tipo de arquivo, até 10 MB. A análise começa assim que o arquivo é escolhido.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            data-testid="file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void analyze(file);
            }}
          />

          {busy && (
            <div className="space-y-2" data-testid="file-upload-progress">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink dark:text-white">
                  {phase === 'uploading' ? 'Enviando' : 'Analisando'}{' '}
                  <span className="font-mono text-xs">{current?.name}</span>
                </span>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">
                  {phase === 'uploading' ? `${progress}%` : 'no antivírus…'}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Envio do arquivo"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-valuetext={
                  phase === 'uploading' ? `${progress}% enviado` : 'Envio concluído, analisando'
                }
                className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              >
                <div
                  className={cn(
                    'h-full rounded-full bg-ink transition-all dark:bg-white',
                    phase === 'analyzing' && 'animate-pulse',
                  )}
                  style={{ width: `${phase === 'analyzing' ? 100 : progress}%` }}
                />
              </div>
            </div>
          )}

          <FormErrorBanner message={uploadError} />

          <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="file-scan-announcer">
            {announcement}
          </div>
        </div>
      </Card>

      {outcome && <ResultCard outcome={outcome} />}

      {error && !data ? (
        <ErrorState
          status={error.status}
          message={error.message}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : !data ? (
        <LoadingSpinner label="Carregando análises…" />
      ) : total === 0 && !resultFilter && !loading ? (
        <EmptyState
          icon={<FileScanIcon size={28} />}
          title="Nenhuma análise ainda"
          description="Envie um arquivo acima para fazer a primeira análise."
        />
      ) : (
        <Card
          title="Análises anteriores"
          subtitle={
            operator
              ? 'Todas as análises da empresa, mais recentes primeiro'
              : 'Suas análises, mais recentes primeiro'
          }
          flush
          aria-busy={loading || undefined}
          data-testid="file-history"
        >
          <ResultFilterBar value={resultFilter} onChange={changeResultFilter} />
          {error && (
            <p
              role="alert"
              className="border-b border-slate-100 px-5 py-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
            >
              {error.message}
            </p>
          )}
          <div className={cn(loading && 'opacity-60 transition-opacity')}>
            <HistoryTable
              items={items}
              showUser={operator}
              emptyRow={
                <>
                  <p>{filterLabel ? `Nenhuma análise ${filterLabel}.` : 'Nenhuma análise nesta página.'}</p>
                  {resultFilter && (
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => changeResultFilter('')}>
                      Limpar filtro
                    </Button>
                  )}
                </>
              }
            />
          </div>
          {loading && (
            <p role="status" className="sr-only">
              Carregando análises…
            </p>
          )}
          {total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={changePageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </Card>
      )}
    </div>
  );
}
