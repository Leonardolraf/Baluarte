import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { ApiError, AuthUser, NotificationPreferences, SecurityPolicy } from '@/types';
import { FEATURES, api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { notify, trackOperation, useUiStore } from '@/store/uiStore';
import { errorMessage, toApiError } from '@/lib/errors';
import { ROLE_LABEL, ROLE_SEVERITY } from '@/lib/roles';
import {
  Button,
  Card,
  ErrorState,
  FormErrorBanner,
  FormField,
  Icons,
  Input,
  KeyValueList,
  LoadingSpinner,
  PageHeader,
  SeverityBadge,
  Skeleton,
  Switch,
  describedBy,
} from '@/components';

const { LockIcon, MoonIcon } = Icons;

const SECTION_CLASS = 'max-w-2xl';

function yesNo(value: boolean): string {
  return value ? 'Sim' : 'Não';
}

/** Corpo de seção cujo recurso a API ativa ainda não expõe (ver `FEATURES`). */
function UnavailableNotice() {
  return <p className="text-sm text-slate-500 dark:text-slate-400">Indisponível nesta API</p>;
}

// ---- Perfil -----------------------------------------------------------------

function ProfileSection({ user }: { user: AuthUser }) {
  return (
    <Card title="Perfil" subtitle="Dados da sua conta na plataforma" className={SECTION_CLASS}>
      <KeyValueList
        columns={2}
        items={[
          { label: 'Nome', value: user.name },
          { label: 'E-mail', value: user.email, mono: true },
          {
            label: 'Perfil',
            value: <SeverityBadge severity={ROLE_SEVERITY[user.role]} label={ROLE_LABEL[user.role]} />,
          },
          { label: 'Identificador', value: user.id, mono: true },
        ]}
      />
    </Card>
  );
}

// ---- Alterar senha ----------------------------------------------------------

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const CHANGE_PASSWORD_FORM_ID = 'change-password-form';
const CHANGE_PASSWORD_SUBTITLE = 'Escolha uma senha que você não use em outros serviços';

function policyHint(policy: SecurityPolicy | null): string {
  if (!policy) return 'Use uma senha forte, conforme a política de segurança da plataforma.';
  const parts = [`Mínimo de ${policy.passwordMinLength} caracteres`];
  if (policy.requireMixedCase) parts.push('letras maiúsculas e minúsculas');
  if (policy.requireNumberAndSymbol) parts.push('pelo menos um número e um símbolo');
  return `${parts.join(', ')}.`;
}

function validateNewPassword(value: string, policy: SecurityPolicy | null): string | true {
  if (!policy) return true;
  if (value.length < policy.passwordMinLength) {
    return `A senha deve ter pelo menos ${policy.passwordMinLength} caracteres.`;
  }
  if (policy.requireMixedCase && !(/[a-z]/.test(value) && /[A-Z]/.test(value))) {
    return 'A senha deve conter letras maiúsculas e minúsculas.';
  }
  if (policy.requireNumberAndSymbol && !(/\d/.test(value) && /[^A-Za-z0-9]/.test(value))) {
    return 'A senha deve conter pelo menos um número e um símbolo.';
  }
  return true;
}

function ChangePasswordSection({ policy }: { policy: SecurityPolicy | null }) {
  if (!FEATURES.changePassword) {
    return (
      <Card title="Alterar senha" subtitle={CHANGE_PASSWORD_SUBTITLE} className={SECTION_CLASS}>
        <UnavailableNotice />
      </Card>
    );
  }
  return <ChangePasswordForm policy={policy} />;
}

function ChangePasswordForm({ policy }: { policy: SecurityPolicy | null }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const hint = policyHint(policy);

  async function onSubmit(values: ChangePasswordFormValues) {
    setFormError(null);
    try {
      const response = await trackOperation(
        api.changePassword({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      );
      notify.success(response.message);
      reset();
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.code === 'SENHA_ATUAL_INCORRETA') {
        setError('currentPassword', { type: 'server', message: apiError.message }, { shouldFocus: true });
      } else if (apiError.code === 'SENHA_FRACA' || apiError.code === 'SENHA_REPETIDA') {
        setError('newPassword', { type: 'server', message: apiError.message }, { shouldFocus: true });
      } else {
        setFormError(errorMessage(err, 'Não foi possível alterar a senha.'));
      }
    }
  }

  return (
    <Card
      title="Alterar senha"
      subtitle={CHANGE_PASSWORD_SUBTITLE}
      className={SECTION_CLASS}
      footer={
        <div className="flex justify-end">
          <Button
            form={CHANGE_PASSWORD_FORM_ID}
            type="submit"
            variant="primary"
            loading={isSubmitting}
            leftIcon={<LockIcon size={16} />}
          >
            Alterar senha
          </Button>
        </div>
      }
    >
      <form id={CHANGE_PASSWORD_FORM_ID} noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormErrorBanner message={formError} />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Senha atual"
            htmlFor="senhaAtual"
            required
            error={errors.currentPassword?.message}
            className="sm:col-span-2"
          >
            <Input
              id="senhaAtual"
              type="password"
              autoComplete="current-password"
              invalid={!!errors.currentPassword}
              aria-describedby={describedBy('senhaAtual', { error: errors.currentPassword?.message })}
              {...register('currentPassword', { required: 'Informe a senha atual.' })}
            />
          </FormField>

          <FormField
            label="Nova senha"
            htmlFor="novaSenha"
            required
            error={errors.newPassword?.message}
            hint={hint}
          >
            <Input
              id="novaSenha"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.newPassword}
              aria-describedby={describedBy('novaSenha', { error: errors.newPassword?.message, hint })}
              {...register('newPassword', {
                required: 'Informe a nova senha.',
                validate: (value) => validateNewPassword(value, policy),
              })}
            />
          </FormField>

          <FormField
            label="Confirmar nova senha"
            htmlFor="confirmarSenha"
            required
            error={errors.confirmPassword?.message}
          >
            <Input
              id="confirmarSenha"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.confirmPassword}
              aria-describedby={describedBy('confirmarSenha', { error: errors.confirmPassword?.message })}
              {...register('confirmPassword', {
                required: 'Confirme a nova senha.',
                validate: (value, values) => value === values.newPassword || 'As senhas não conferem',
              })}
            />
          </FormField>
        </div>
      </form>
    </Card>
  );
}

// ---- Notificações -----------------------------------------------------------

interface NotificationOption {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}

const NOTIFICATION_OPTIONS: NotificationOption[] = [
  {
    key: 'emailAlerts',
    label: 'Alertas por e-mail',
    description: 'Receba um e-mail a cada nova vulnerabilidade crítica ou alta',
  },
  {
    key: 'criticalOnly',
    label: 'Somente críticas',
    description: 'Limite os alertas às vulnerabilidades de severidade crítica',
  },
  {
    key: 'weeklyDigest',
    label: 'Resumo semanal',
    description: 'Panorama semanal do risco técnico e humano da empresa',
  },
  {
    key: 'campaignReports',
    label: 'Relatórios de campanha',
    description: 'Receba o relatório ao encerrar cada campanha de phishing simulado',
  },
];

const NOTIFICATIONS_SUBTITLE = 'Escolha quais avisos você recebe por e-mail';

function NotificationsSection() {
  if (!FEATURES.notificationPreferences) {
    return (
      <Card title="Notificações" subtitle={NOTIFICATIONS_SUBTITLE} className={SECTION_CLASS}>
        <UnavailableNotice />
      </Card>
    );
  }
  return <NotificationsForm />;
}

function NotificationsForm() {
  const { data, error, loading, reload, setData } = useAsync<NotificationPreferences>(
    () => api.getNotificationPreferences(),
    [],
  );
  const [overrides, setOverrides] = useState<Partial<NotificationPreferences>>({});
  const [saving, setSaving] = useState(false);

  const current: NotificationPreferences | null = data ? { ...data, ...overrides } : null;
  const dirty =
    !!data && !!current && NOTIFICATION_OPTIONS.some((option) => current[option.key] !== data[option.key]);

  function toggle(key: keyof NotificationPreferences, checked: boolean) {
    setOverrides((previous) => ({ ...previous, [key]: checked }));
  }

  async function handleSave() {
    if (!current) return;
    setSaving(true);
    try {
      const saved = await trackOperation(api.updateNotificationPreferences(current));
      setData(saved);
      setOverrides({});
      notify.success('Preferências salvas');
    } catch (err) {
      notify.error(errorMessage(err, 'Não foi possível salvar as preferências.'));
    } finally {
      setSaving(false);
    }
  }

  let body: JSX.Element;
  if (loading && !data) {
    body = <LoadingSpinner label="Carregando notificações…" />;
  } else if (loading && current) {
    body = (
      <div className="divide-y divide-slate-100 dark:divide-slate-800" aria-busy="true">
        {NOTIFICATION_OPTIONS.map((option) => (
          <div key={option.key} className="flex items-center justify-between gap-4 py-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        ))}
      </div>
    );
  } else if (error && !current) {
    body = (
      <ErrorState
        compact
        message={error.message}
        status={error.status}
        onRetry={() => reload()}
        retrying={loading}
      />
    );
  } else if (current) {
    body = (
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {NOTIFICATION_OPTIONS.map((option) => (
          <Switch
            key={option.key}
            id={`notificacao-${option.key}`}
            label={option.label}
            description={option.description}
            checked={current[option.key]}
            onChange={(checked) => toggle(option.key, checked)}
            disabled={saving}
          />
        ))}
      </div>
    );
  } else {
    body = <ErrorState compact onRetry={() => reload()} retrying={loading} />;
  }

  return (
    <Card
      title="Notificações"
      subtitle={NOTIFICATIONS_SUBTITLE}
      className={SECTION_CLASS}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!dirty}>
            Salvar preferências
          </Button>
        </div>
      }
    >
      {body}
    </Card>
  );
}

// ---- Aparência --------------------------------------------------------------

function AppearanceSection() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  return (
    <Card title="Aparência" subtitle="Preferência visual salva neste navegador" className={SECTION_CLASS}>
      <Switch
        id="tema-escuro"
        label={
          <span className="inline-flex items-center gap-1.5">
            <MoonIcon size={14} />
            Tema escuro
          </span>
        }
        description="Alterna entre o tema claro e o escuro da interface"
        checked={theme === 'dark'}
        onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
      />
    </Card>
  );
}

// ---- Política de segurança --------------------------------------------------

function SecurityPolicySection({
  policy,
  error,
  loading,
  onRetry,
}: {
  policy: SecurityPolicy | null;
  error: ApiError | null;
  loading: boolean;
  onRetry: () => void;
}) {
  let body: JSX.Element;
  if (loading && !policy) {
    body = <LoadingSpinner label="Carregando política de segurança…" />;
  } else if (loading && policy) {
    body = (
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2" aria-busy="true">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  } else if (error && !policy) {
    body = (
      <ErrorState
        compact
        message={error.message}
        status={error.status}
        onRetry={onRetry}
        retrying={loading}
      />
    );
  } else if (policy) {
    body = (
      <KeyValueList
        columns={2}
        items={[
          { label: 'Comprimento mínimo da senha', value: `${policy.passwordMinLength} caracteres` },
          { label: 'Maiúsculas e minúsculas obrigatórias', value: yesNo(policy.requireMixedCase) },
          { label: 'Número e símbolo obrigatórios', value: yesNo(policy.requireNumberAndSymbol) },
          { label: 'Algoritmo do token', value: policy.tokenAlgorithm, mono: true },
          { label: 'Expiração da sessão', value: `${policy.sessionExpirationMinutes} min` },
          { label: 'Limite de tentativas de login', value: `${policy.loginAttemptLimit} tentativas` },
          { label: 'Autenticação em dois fatores', value: yesNo(policy.twoFactorEnabled) },
          { label: 'Log de auditoria imutável', value: yesNo(policy.auditLogImmutable) },
          { label: 'Retenção da auditoria', value: `${policy.auditRetentionMonths} meses` },
        ]}
      />
    );
  } else {
    body = <ErrorState compact onRetry={onRetry} retrying={loading} />;
  }

  return (
    <Card
      title="Política de segurança da plataforma"
      subtitle="Regras aplicadas a todas as contas; alteradas apenas pelo administrador"
      className={SECTION_CLASS}
    >
      {body}
    </Card>
  );
}

// ---- Página -----------------------------------------------------------------

export default function SettingsPage() {
  const { user } = useAuth();
  const {
    data: policy,
    error: policyError,
    loading: policyLoading,
    reload: reloadPolicy,
  } = useAsync<SecurityPolicy>(() => api.getSecurityPolicy(), []);

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Preferências da sua conta e políticas de segurança da plataforma."
      />
      <div className="space-y-6">
        {user ? (
          <ProfileSection user={user} />
        ) : (
          <Card title="Perfil" className={SECTION_CLASS}>
            <ErrorState
              compact
              title="Sessão indisponível"
              message="Faça login novamente para ver seus dados."
            />
          </Card>
        )}
        <ChangePasswordSection policy={policy} />
        <NotificationsSection />
        <AppearanceSection />
        <SecurityPolicySection
          policy={policy}
          error={policyError}
          loading={policyLoading}
          onRetry={() => reloadPolicy()}
        />
      </div>
    </div>
  );
}
