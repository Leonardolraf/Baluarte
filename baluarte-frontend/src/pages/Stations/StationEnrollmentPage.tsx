import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { StationEnrollment, StationEnrollmentCode, StationEnrollmentListResponse } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { errorMessage, isHttpError } from '@/lib/errors';
import { copyToClipboard } from '@/lib/clipboard';
import { formatDateTime } from '@/lib/format';
import {
  ENROLLMENT_STATE_CLASS,
  ENROLLMENT_STATE_HINT,
  ENROLLMENT_STATE_LABEL,
  enrollmentStateKey,
} from '@/lib/stationEnrollment';
import { notify } from '@/store/uiStore';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  FormField,
  Input,
  LoadingSpinner,
  PageHeader,
  StatusPill,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { CheckCircleIcon, CopyIcon, InfoIcon, KeyIcon, RefreshIcon } from '@/components/icons';

/** Campo do formulário que recebe o erro da API (o resto vai para o banner). */
const FIELD_BY_CODE: Record<string, 'name' | 'host' | 'description'> = {
  NOME_INVALIDO: 'name',
  HOST_INVALIDO: 'host',
  DESCRICAO_INVALIDA: 'description',
};

/** Cartão do código recém-emitido: a única vez em que ele aparece (o servidor guarda só o hash). */
function IssuedCode({ issued, stationName }: { issued: StationEnrollmentCode; stationName: string }) {
  return (
    <Card
      title="Código de vínculo gerado"
      subtitle={`Para a estação “${stationName}”`}
      data-testid="enrollment-issued"
      className="ring-2 ring-green-600/30 dark:ring-green-500/40"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <code
            data-testid="enrollment-code"
            className="select-all rounded-lg bg-slate-100 px-4 py-3 font-mono text-2xl font-semibold tracking-wider text-ink dark:bg-slate-800 dark:text-white sm:text-3xl"
          >
            {issued.code}
          </code>
          <Button
            variant="outline"
            leftIcon={<CopyIcon size={16} />}
            onClick={() => copyToClipboard(issued.code, 'Código copiado')}
          >
            Copiar código
          </Button>
        </div>
        <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex gap-2">
            <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
            <span>Na estação, rode o instalador do agente Baluarte e cole este código quando ele pedir.</span>
          </li>
          <li className="flex gap-2">
            <InfoIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <span>
              Vale para <strong>uma</strong> instalação, até{' '}
              <time dateTime={issued.expiresAt}>{formatDateTime(issued.expiresAt)}</time>.
            </span>
          </li>
          <li className="flex gap-2">
            <InfoIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <span>
              O código não é mostrado de novo: se perder, revogue este e gere outro. Depois da instalação, a
              estação aparece em{' '}
              <Link to="/stations" className="font-medium underline underline-offset-4">
                Estações monitoradas
              </Link>
              .
            </span>
          </li>
        </ul>
      </div>
    </Card>
  );
}

function EnrollmentRows({
  items,
  revoking,
  onRevoke,
}: {
  items: StationEnrollment[];
  revoking: string | null;
  onRevoke: (item: StationEnrollment) => void;
}) {
  return (
    <TBody>
      {items.map((item) => {
        const key = enrollmentStateKey(item);
        return (
          <Tr key={item.id} data-testid="enrollment-row">
            <Td>
              <div className="font-medium text-ink dark:text-white">{item.name}</div>
              {item.host && (
                <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{item.host}</div>
              )}
            </Td>
            <Td>
              <span title={ENROLLMENT_STATE_HINT[key]}>
                <StatusPill label={ENROLLMENT_STATE_LABEL[key]} colorClass={ENROLLMENT_STATE_CLASS[key]} />
              </span>
            </Td>
            <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
              <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
            </Td>
            <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
              <time dateTime={item.expiresAt}>{formatDateTime(item.expiresAt)}</time>
            </Td>
            <Td align="right">
              {item.state === 'pending' ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={revoking === item.id}
                  disabled={revoking !== null && revoking !== item.id}
                  onClick={() => onRevoke(item)}
                  aria-label={`Revogar o código da estação ${item.name}`}
                >
                  Revogar
                </Button>
              ) : null}
            </Td>
          </Tr>
        );
      })}
    </TBody>
  );
}

/**
 * Vincular estação (#9, só Administrador): gera o código de uso único que o instalador do agente
 * pede (é o enroll_secret daquela estação, válido por 24 h) e lista os códigos já emitidos, com o
 * estado e a opção de revogar o que ainda não foi usado. O código aparece só na emissão.
 */
export default function StationEnrollmentPage() {
  const list = useAsync<StationEnrollmentListResponse>(() => api.listStationEnrollments(), []);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'host' | 'description', string>>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<{ code: StationEnrollmentCode; name: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    if (!name.trim()) {
      setFieldErrors({ name: 'Informe o nome da estação.' });
      return;
    }
    setSubmitting(true);
    try {
      const code = await api.createStationEnrollment({ name, host, description });
      setIssued({ code, name: name.trim() });
      setName('');
      setHost('');
      setDescription('');
      void list.reload();
    } catch (err) {
      const field = isHttpError(err) ? FIELD_BY_CODE[err.code ?? ''] : undefined;
      if (field) setFieldErrors({ [field]: errorMessage(err) });
      else setFormError(errorMessage(err, 'Não foi possível gerar o código.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onRevoke = async (item: StationEnrollment) => {
    if (!window.confirm(`Revogar o código da estação “${item.name}”? Ele deixa de valer na hora.`)) return;
    setRevoking(item.id);
    try {
      await api.revokeStationEnrollment(item.id);
      notify.success('Código revogado');
      if (issued?.code.id === item.id) setIssued(null);
    } catch (err) {
      notify.error(errorMessage(err, 'Não foi possível revogar o código.'));
    } finally {
      setRevoking(null);
      void list.reload();
    }
  };

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vincular estação"
        description="Gere o código que o instalador do agente pede. Cada código vale para uma instalação, por 24 horas."
        breadcrumbs={[{ label: 'Estações monitoradas', to: '/stations' }, { label: 'Vincular estação' }]}
      />

      {issued && <IssuedCode issued={issued.code} stationName={issued.name} />}

      <Card title="Novo código" subtitle="Os dados identificam a estação no painel depois da instalação">
        <form
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="space-y-4"
          aria-label="Gerar código de vínculo"
        >
          <FormErrorBanner message={formError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Nome da estação" htmlFor="enrollment-name" required error={fieldErrors.name}>
              <Input
                id="enrollment-name"
                value={name}
                maxLength={255}
                onChange={(e) => setName(e.target.value)}
                invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'enrollment-name-error' : undefined}
                placeholder="Notebook da apresentação"
                autoComplete="off"
              />
            </FormField>
            <FormField
              label="Host (opcional)"
              htmlFor="enrollment-host"
              error={fieldErrors.host}
              hint="Nome na rede com domínio (ex.: notebook.empresa.local). Sem ele, vale o nome que o agente informar."
            >
              <Input
                id="enrollment-host"
                value={host}
                mono
                onChange={(e) => setHost(e.target.value)}
                invalid={!!fieldErrors.host}
                aria-describedby={fieldErrors.host ? 'enrollment-host-error' : 'enrollment-host-hint'}
                placeholder="notebook.empresa.local"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
          </div>
          <FormField
            label="Descrição (opcional)"
            htmlFor="enrollment-description"
            error={fieldErrors.description}
          >
            <Input
              id="enrollment-description"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              invalid={!!fieldErrors.description}
              aria-describedby={fieldErrors.description ? 'enrollment-description-error' : undefined}
              autoComplete="off"
            />
          </FormField>
          <div className="flex justify-end">
            <Button type="submit" loading={submitting} leftIcon={<KeyIcon size={16} />}>
              Gerar código
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Códigos emitidos"
        subtitle={
          list.data && list.data.total > items.length
            ? `Os ${items.length} mais recentes de ${list.data.total}`
            : 'Mais recentes primeiro'
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshIcon size={14} />}
            loading={list.loading}
            onClick={() => void list.reload()}
          >
            Atualizar
          </Button>
        }
        flush
      >
        {list.error && !list.data ? (
          <div className="p-4">
            <ErrorState
              status={list.error.status}
              message={list.error.message}
              onRetry={() => void list.reload()}
              retrying={list.loading}
            />
          </div>
        ) : !list.data ? (
          <LoadingSpinner label="Carregando códigos…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<KeyIcon size={28} />}
            title="Nenhum código emitido"
            description="Gere o primeiro código acima e use-o no instalador da estação."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Estação</Th>
                  <Th>Estado</Th>
                  <Th>Emitido em</Th>
                  <Th>Válido até</Th>
                  <Th align="right">
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </THead>
              <EnrollmentRows items={items} revoking={revoking} onRevoke={(item) => void onRevoke(item)} />
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
