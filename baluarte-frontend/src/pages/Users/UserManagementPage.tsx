import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { User } from '@/types';
import { api, FEATURES } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useSort, type SortAccessor } from '@/hooks/useSort';
import { usePagination } from '@/hooks/usePagination';
import { useAuth } from '@/contexts/AuthContext';
import { notify, trackOperation } from '@/store/uiStore';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatRelative, initials } from '@/lib/format';
import { ROLE_LABEL, ROLE_SEVERITY } from '@/lib/roles';
import { SEVERITY_BADGE_CLASS, USER_STATUS_CLASS, USER_STATUS_LABEL } from '@/lib/severity';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icons,
  Input,
  LinkButton,
  LoadingSpinner,
  PageHeader,
  Pagination,
  SeverityBadge,
  StatCard,
  StatusPill,
  Table,
  TableContainer,
  TableEmptyRow,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';

type SortKey = 'name' | 'role' | 'status' | 'createdAt';

const PAGE_SIZE = 10;

const SORT_ACCESSORS: Record<SortKey, SortAccessor<User>> = {
  name: (user) => user.name,
  role: (user) => ROLE_LABEL[user.role],
  status: (user) => USER_STATUS_LABEL[user.status],
  createdAt: (user) => {
    const time = new Date(user.createdAt).getTime();
    return Number.isNaN(time) ? null : time;
  },
};

interface ConfirmDeleteDialogProps {
  user: User;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmação de exclusão: overlay fixo, foco inicial em "Cancelar", Tab preso no diálogo, Escape fecha. */
function ConfirmDeleteDialog({ user, busy, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !dialogRef.current.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px] dark:bg-slate-950/70">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="surface w-full max-w-md animate-fade-in p-5"
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
              SEVERITY_BADGE_CLASS.critical,
            )}
          >
            <Icons.AlertTriangleIcon size={20} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink dark:text-white">
              Excluir usuário {user.name}?
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Esta ação não pode ser desfeita. O acesso de{' '}
              <span className="font-mono text-xs">{user.email}</span> será revogado imediatamente.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            loading={busy}
            leftIcon={<Icons.TrashIcon size={16} />}
          >
            Excluir
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const { data, error, loading, reload, setData } = useAsync(() => api.listUsers(), []);

  const canEdit = FEATURES.userEdit;
  const canDelete = FEATURES.userDelete;
  const showActions = canEdit || canDelete;
  const columnCount = showActions ? 7 : 6;

  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const users = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) => user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term),
    );
  }, [users, query]);

  const { sorted, toggle, directionOf } = useSort(filtered, SORT_ACCESSORS, {
    key: 'name',
    direction: 'asc',
  });
  const { page, pageSize, total, pageItems, setPage, setPageSize } = usePagination(sorted, PAGE_SIZE);

  const counts = useMemo(
    () => ({
      admin: users.filter((user) => user.role === 'admin').length,
      analyst: users.filter((user) => user.role === 'analyst').length,
      collaborator: users.filter((user) => user.role === 'collaborator').length,
    }),
    [users],
  );

  const openDelete = (user: User) => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingDelete(user);
  };

  const closeDelete = useCallback(() => {
    setPendingDelete(null);
    returnFocusTo.current?.focus();
    returnFocusTo.current = null;
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await trackOperation(api.deleteUser(target.id));
      setData((previous) => (previous ? previous.filter((user) => user.id !== target.id) : previous));
      notify.success('Usuário excluído');
    } catch (err) {
      notify.error(errorMessage(err));
    } finally {
      setDeleting(false);
      closeDelete();
    }
  }, [pendingDelete, setData, closeDelete]);

  const header = (
    <PageHeader
      title="Usuários e perfis de acesso"
      description="Controle de acesso baseado em perfis (RBAC): Administrador, Analista e Colaborador."
      actions={
        <LinkButton to="/users/new" leftIcon={<Icons.PlusIcon size={16} />}>
          Novo usuário
        </LinkButton>
      }
    />
  );

  if (loading && !data) {
    return (
      <>
        {header}
        <LoadingSpinner label="Carregando usuários…" />
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        {header}
        <ErrorState
          message={error.message}
          status={error.status}
          onRetry={() => reload()}
          retrying={loading}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total"
            value={users.length}
            hint="Contas cadastradas"
            icon={<Icons.UsersIcon size={18} />}
          />
          <StatCard
            label="Administradores"
            value={counts.admin}
            hint="Acesso total à plataforma"
            icon={<Icons.ShieldIcon size={18} />}
          />
          <StatCard
            label="Analistas"
            value={counts.analyst}
            hint="Varreduras e campanhas"
            icon={<Icons.ActivityIcon size={18} />}
          />
          <StatCard
            label="Colaboradores"
            value={counts.collaborator}
            hint="Dashboard e treinamentos"
            icon={<Icons.UserIcon size={18} />}
          />
        </div>

        <Card
          flush
          title="Usuários cadastrados"
          subtitle="O perfil define o que cada pessoa pode ver e fazer."
        >
          {users.length === 0 ? (
            <EmptyState
              compact
              title="Nenhum usuário cadastrado"
              description="Cadastre o primeiro usuário para começar a distribuir perfis de acesso."
              action={{ label: 'Novo usuário', to: '/users/new' }}
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <label htmlFor="user-search" className="sr-only">
                    Buscar por nome ou e-mail
                  </label>
                  <Icons.SearchIcon
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <Input
                    id="user-search"
                    type="search"
                    placeholder="Buscar por nome ou e-mail…"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                  {total} de {users.length} {users.length === 1 ? 'usuário' : 'usuários'}
                </p>
              </div>

              {!showActions && (
                <p className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Edição e exclusão de usuários ainda não estão disponíveis nesta API.
                </p>
              )}

              <TableContainer bare>
                <Table>
                  <THead>
                    <tr>
                      <Th sortable sorted={directionOf('name')} onSort={() => toggle('name')}>
                        Usuário
                      </Th>
                      <Th>E-mail</Th>
                      <Th sortable sorted={directionOf('role')} onSort={() => toggle('role')}>
                        Perfil
                      </Th>
                      <Th sortable sorted={directionOf('status')} onSort={() => toggle('status')}>
                        Status
                      </Th>
                      <Th
                        sortable
                        sorted={directionOf('createdAt')}
                        onSort={() => toggle('createdAt')}
                        className="hidden 2xl:table-cell"
                      >
                        Criado em
                      </Th>
                      <Th className="hidden xl:table-cell">Último acesso</Th>
                      {showActions && <Th align="right">Ações</Th>}
                    </tr>
                  </THead>
                  <TBody>
                    {pageItems.length === 0 ? (
                      <TableEmptyRow colSpan={columnCount}>Nenhum usuário encontrado</TableEmptyRow>
                    ) : (
                      pageItems.map((user) => {
                        const isSelf = user.id === currentUser?.id;
                        return (
                          <Tr key={user.id}>
                            <Td>
                              <div className="flex items-center gap-3">
                                <span
                                  aria-hidden="true"
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                >
                                  {initials(user.name)}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate font-medium text-ink dark:text-white">
                                      {user.name}
                                    </span>
                                    {isSelf && <span className="label-caps">você</span>}
                                  </div>
                                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                    {user.department ?? 'Sem departamento'}
                                  </div>
                                </div>
                              </div>
                            </Td>
                            <Td mono>{user.email}</Td>
                            <Td>
                              <SeverityBadge
                                severity={ROLE_SEVERITY[user.role]}
                                label={ROLE_LABEL[user.role]}
                              />
                            </Td>
                            <Td>
                              <StatusPill
                                label={USER_STATUS_LABEL[user.status]}
                                colorClass={USER_STATUS_CLASS[user.status]}
                              />
                            </Td>
                            <Td className="hidden whitespace-nowrap 2xl:table-cell">
                              <time dateTime={user.createdAt} title={formatDateTime(user.createdAt)}>
                                {formatDate(user.createdAt)}
                              </time>
                            </Td>
                            <Td className="hidden whitespace-nowrap xl:table-cell">
                              {user.lastLoginAt ? (
                                <time dateTime={user.lastLoginAt} title={formatDateTime(user.lastLoginAt)}>
                                  {formatRelative(user.lastLoginAt)}
                                </time>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400">Nunca</span>
                              )}
                            </Td>
                            {showActions && (
                              <Td align="right">
                                <div className="flex justify-end gap-1">
                                  {canEdit && (
                                    <LinkButton
                                      to={`/users/${user.id}/edit`}
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Editar ${user.name}`}
                                      title="Editar"
                                      leftIcon={<Icons.EditIcon size={16} />}
                                    />
                                  )}
                                  {canDelete && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Excluir ${user.name}`}
                                      title={isSelf ? 'Você não pode excluir a própria conta' : 'Excluir'}
                                      disabled={isSelf}
                                      onClick={() => openDelete(user)}
                                      leftIcon={<Icons.TrashIcon size={16} />}
                                      className="text-severity-critical hover:text-severity-critical"
                                    />
                                  )}
                                </div>
                              </Td>
                            )}
                          </Tr>
                        );
                      })
                    )}
                  </TBody>
                </Table>
              </TableContainer>

              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </Card>
      </div>

      {pendingDelete && (
        <ConfirmDeleteDialog
          user={pendingDelete}
          busy={deleting}
          onCancel={closeDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}
