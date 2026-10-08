import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import type { RBACRole, User, UserInput, UserStatus } from '@/types';
import { RBAC_ROLES } from '@/types';
import { api, FEATURES } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { notify, trackOperation } from '@/store/uiStore';
import { errorMessage, toApiError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLE_SEVERITY } from '@/lib/roles';
import { USER_STATUS_CLASS, USER_STATUS_LABEL } from '@/lib/severity';
import {
  Button,
  Card,
  describedBy,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  FormField,
  Icons,
  Input,
  LoadingSpinner,
  PageHeader,
  Select,
  SeverityBadge,
  StatusPill,
} from '@/components';

interface UserFormValues {
  name: string;
  email: string;
  role: RBACRole;
  department: string;
  status: UserStatus;
}

const DEFAULT_VALUES: UserFormValues = {
  name: '',
  email: '',
  role: 'collaborator',
  department: '',
  status: 'active',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MIN = 3;
const NAME_MAX = 80;
const EMAIL_HINT = 'Usado para login e para o envio de alertas.';

const USER_STATUSES: readonly UserStatus[] = ['active', 'inactive', 'pending'];

/** Códigos de erro do backend que apontam para um campo específico do formulário. */
const FIELD_BY_ERROR_CODE: Partial<Record<string, keyof UserFormValues>> = {
  DEPARTAMENTO_INVALIDO: 'department',
  EMAIL_DUPLICADO: 'email',
  EMAIL_INVALIDO: 'email',
  NOME_OBRIGATORIO: 'name',
  PERFIL_INVALIDO: 'role',
  ULTIMO_ADMIN: 'role',
  AUTO_INATIVACAO: 'status',
};

function toFormValues(user: User): UserFormValues {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department ?? '',
    status: user.status,
  };
}

export default function UserFormPage() {
  const { id } = useParams<{ id: string }>();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isSelf = editing && currentUser?.id === id;

  const { data, error, loading, reload } = useAsync<User | null>(
    () => (id ? api.getUser(id) : Promise.resolve(null)),
    [id],
  );
  // Opções vêm da tabela de departamentos; se a lista falhar, o campo fica só com o valor atual.
  const { data: departments } = useAsync<string[]>(() => api.listDepartments(), []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({ defaultValues: DEFAULT_VALUES });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data) reset(toFormValues(data));
  }, [data, reset]);

  const selectedRole = watch('role');
  const roleHint = ROLE_DESCRIPTION[selectedRole];

  const departmentOptions = useMemo(() => {
    const lista = departments ?? [];
    return data?.department && !lista.includes(data.department) ? [...lista, data.department] : lista;
  }, [data, departments]);

  const onSubmit = async (values: UserFormValues) => {
    setFormError(null);
    const input: UserInput = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      role: values.role,
      department: values.department.trim(),
    };
    if (editing) input.status = values.status;

    try {
      if (id) await trackOperation(api.updateUser(id, input));
      else {
        const criado = await trackOperation(api.createUser(input));
        // O cadastro vale mesmo se o e-mail falhar: avisa para reenviar pela lista.
        if (!criado.inviteSent) {
          notify.error('Usuário cadastrado, mas o convite não pôde ser enviado. Reenvie pela lista.');
          navigate('/users');
          return;
        }
      }
      notify.success(editing ? 'Usuário atualizado' : 'Usuário cadastrado e convite enviado');
      navigate('/users');
    } catch (err) {
      const apiError = toApiError(err);
      const field = FIELD_BY_ERROR_CODE[apiError.code];
      if (field) setError(field, { type: 'server', message: apiError.message }, { shouldFocus: true });
      else setFormError(errorMessage(err));
    }
  };

  // Ação de acesso da conta editada: conta Pendente ainda não tem senha (reenvia o
  // convite); conta Ativa redefine a que já existe. Inativa não recebe link nenhum.
  const [enviandoAcesso, setEnviandoAcesso] = useState(false);
  const acaoAcesso =
    editing && data?.status === 'pending'
      ? { rotulo: 'Reenviar convite', executar: () => api.resendInvite(data.id) }
      : editing && data?.status === 'active'
        ? { rotulo: 'Enviar link de redefinição', executar: () => api.sendPasswordReset(data!.id) }
        : null;

  async function dispararAcessoDaConta() {
    if (!acaoAcesso) return;
    setEnviandoAcesso(true);
    try {
      const resposta = await trackOperation(acaoAcesso.executar());
      notify.success(resposta.message);
    } catch (err) {
      notify.error(errorMessage(err, 'Não foi possível enviar o e-mail.'));
    } finally {
      setEnviandoAcesso(false);
    }
  }

  const pageTitle = editing ? 'Editar usuário' : 'Novo usuário';
  const header = (
    <PageHeader
      title={pageTitle}
      description={
        editing
          ? 'Atualize os dados cadastrais, o perfil de acesso e o status da conta.'
          : 'Cadastre uma nova conta e defina o perfil de acesso conforme a função da pessoa.'
      }
      breadcrumbs={[{ label: 'Usuários', to: '/users' }, { label: pageTitle }]}
      actions={
        acaoAcesso ? (
          <Button
            variant="outline"
            leftIcon={<Icons.SendIcon size={16} />}
            loading={enviandoAcesso}
            onClick={() => void dispararAcessoDaConta()}
          >
            {acaoAcesso.rotulo}
          </Button>
        ) : undefined
      }
      meta={
        data ? (
          <>
            <SeverityBadge severity={ROLE_SEVERITY[data.role]} label={ROLE_LABEL[data.role]} />
            <StatusPill label={USER_STATUS_LABEL[data.status]} colorClass={USER_STATUS_CLASS[data.status]} />
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{data.email}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Criado em {formatDateTime(data.createdAt)}
            </span>
          </>
        ) : undefined
      }
    />
  );

  if (editing && !FEATURES.userEdit) {
    return (
      <>
        {header}
        <EmptyState
          tone="neutral"
          title="Edição indisponível nesta API"
          description="A API atual ainda não permite alterar usuários existentes. Você pode cadastrar novas contas normalmente."
          action={{ label: 'Voltar para usuários', to: '/users' }}
          className="min-h-[50vh]"
        />
      </>
    );
  }

  if (editing && loading && !data) {
    return (
      <>
        {header}
        <LoadingSpinner label="Carregando usuário…" />
      </>
    );
  }

  if (editing && error && !data) {
    return (
      <>
        {header}
        <ErrorState
          title="Não foi possível carregar o usuário"
          message={error.message}
          status={error.status}
          onRetry={() => reload()}
          retrying={loading}
        />
      </>
    );
  }

  const nameError = errors.name?.message;
  const emailError = errors.email?.message;
  const roleError = errors.role?.message;
  const departmentError = errors.department?.message;
  const statusError = errors.status?.message;
  const statusHint = isSelf
    ? 'Você não pode inativar a própria conta.'
    : 'Contas pendentes aguardam o primeiro acesso para se tornarem ativas.';

  return (
    <>
      {header}
      <form onSubmit={handleSubmit(onSubmit)} noValidate aria-busy={isSubmitting || undefined}>
        <Card
          className="max-w-2xl"
          title="Dados do usuário"
          subtitle="Campos marcados com * são obrigatórios."
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => navigate('/users')} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting} leftIcon={<Icons.CheckIcon size={16} />}>
                Salvar
              </Button>
            </div>
          }
        >
          <div className="space-y-5">
            <FormErrorBanner message={formError} />

            {!editing && (
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <Icons.InfoIcon size={16} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
                <p>
                  A conta é criada como{' '}
                  <strong className="font-medium text-ink dark:text-white">Pendente</strong> e recebe um
                  convite por e-mail para criar a própria senha. Não existe senha provisória; enquanto o
                  convite não for aceito, o acesso fica bloqueado.
                </p>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label="Nome completo"
                htmlFor="nome"
                required
                error={nameError}
                className="sm:col-span-2"
              >
                <Input
                  id="nome"
                  type="text"
                  autoComplete="name"
                  placeholder="Ex.: Ana Souza"
                  maxLength={NAME_MAX}
                  invalid={Boolean(nameError)}
                  aria-describedby={describedBy('nome', { error: nameError })}
                  {...register('name', {
                    required: 'Nome é obrigatório',
                    validate: (value) => {
                      const length = value.trim().length;
                      if (length < NAME_MIN) return `Informe ao menos ${NAME_MIN} caracteres`;
                      if (length > NAME_MAX) return `Máximo de ${NAME_MAX} caracteres`;
                      return true;
                    },
                  })}
                />
              </FormField>

              <FormField
                label="E-mail corporativo"
                htmlFor="email"
                required
                error={emailError}
                hint={EMAIL_HINT}
                className="sm:col-span-2"
              >
                <Input
                  id="email"
                  type="email"
                  mono
                  autoComplete="email"
                  placeholder="nome.sobrenome@empresa.com"
                  invalid={Boolean(emailError)}
                  aria-describedby={describedBy('email', { error: emailError, hint: EMAIL_HINT })}
                  {...register('email', {
                    required: 'E-mail é obrigatório',
                    pattern: { value: EMAIL_RE, message: 'Formato de e-mail inválido' },
                  })}
                />
              </FormField>

              <FormField label="Perfil de acesso" htmlFor="perfil" required error={roleError} hint={roleHint}>
                <Select
                  id="perfil"
                  invalid={Boolean(roleError)}
                  aria-describedby={describedBy('perfil', { error: roleError, hint: roleHint })}
                  {...register('role', { required: 'Perfil é obrigatório' })}
                >
                  {RBAC_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Departamento" htmlFor="departamento" error={departmentError}>
                <Select
                  id="departamento"
                  invalid={Boolean(departmentError)}
                  aria-describedby={describedBy('departamento', { error: departmentError })}
                  {...register('department')}
                >
                  <option value="">Sem departamento</option>
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </Select>
              </FormField>

              {editing && (
                <FormField label="Status da conta" htmlFor="status" error={statusError} hint={statusHint}>
                  <Select
                    id="status"
                    invalid={Boolean(statusError)}
                    aria-describedby={describedBy('status', { error: statusError, hint: statusHint })}
                    {...register('status')}
                  >
                    {USER_STATUSES.map((status) => (
                      <option key={status} value={status} disabled={isSelf && status === 'inactive'}>
                        {USER_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
            </div>
          </div>
        </Card>
      </form>
    </>
  );
}
