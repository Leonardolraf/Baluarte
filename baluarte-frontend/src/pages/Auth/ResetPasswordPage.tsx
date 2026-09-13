import { useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { FEATURES, api } from '@/services/api';
import { errorMessage, toApiError } from '@/lib/errors';
import { Button, FormErrorBanner, FormField, Input, LinkButton, describedBy } from '@/components';
import { ArrowLeftIcon, CheckCircleIcon, InfoIcon, LockIcon } from '@/components/icons';

// Fluxo em duas etapas na mesma rota:
//  1. /reset-password            -> informa o e-mail; a API envia (ou, em dev, imprime) o link com o token.
//  2. /reset-password?token=...  -> define a nova senha com o token recebido.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';

  let content: ReactElement;
  if (!FEATURES.passwordReset) content = <UnavailableStep />;
  else if (token) content = <ConfirmStep token={token} />;
  else content = <RequestStep />;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="surface w-full max-w-md p-6 sm:p-8">{content}</div>
    </div>
  );
}

// ---- Cabeçalho e blocos reutilizados -----------------------------------------

function StepHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex flex-col items-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-white dark:bg-white dark:text-ink">
        <LockIcon size={24} />
      </span>
      <h1 className="display mt-4 text-2xl text-ink dark:text-white">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
    </header>
  );
}

function SuccessPanel({
  title,
  message,
  hint,
  action,
}: {
  title: string;
  message: string;
  hint?: string;
  action: { to: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center text-center" id="mensagem" role="status">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-ink dark:bg-slate-700 dark:text-white">
        <CheckCircleIcon size={30} />
      </span>
      <h1 className="display mt-4 text-2xl text-ink dark:text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <LinkButton to={action.to} className="mt-6 w-full" leftIcon={<ArrowLeftIcon size={16} />}>
        {action.label}
      </LinkButton>
    </div>
  );
}

function BackToLogin() {
  return (
    <div className="text-center">
      <Link
        to="/login"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink underline-offset-4 hover:underline dark:text-white"
      >
        <ArrowLeftIcon size={14} />
        Voltar ao login
      </Link>
    </div>
  );
}

// ---- Etapa 1: solicitar o link ------------------------------------------------

interface RequestFormValues {
  email: string;
}

function RequestStep() {
  const [confirmation, setConfirmation] = useState<{ message: string; demoToken?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestFormValues>({ defaultValues: { email: '' } });

  const onSubmit = async (values: RequestFormValues) => {
    setError(null);
    try {
      const response = await api.requestPasswordReset(values.email.trim());
      setConfirmation({ message: response.message, demoToken: response.demoToken });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar o link. Tente novamente.'));
    }
  };

  if (confirmation) {
    return (
      <>
        <SuccessPanel
          title="Solicitação enviada"
          message={confirmation.message}
          hint="Não recebeu? Verifique a caixa de spam ou aguarde alguns minutos antes de tentar de novo."
          action={{ to: '/login', label: 'Voltar ao login' }}
        />
        {confirmation.demoToken && (
          <div
            role="note"
            aria-labelledby="demo-reset-title"
            className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50"
          >
            <p id="demo-reset-title" className="label-caps">
              Ambiente de demonstração
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Nenhum e-mail é enviado aqui. Use o link abaixo, que corresponde ao que chegaria na sua caixa de
              entrada.
            </p>
            <LinkButton
              to={`/reset-password?token=${encodeURIComponent(confirmation.demoToken)}`}
              variant="outline"
              className="mt-3 w-full"
            >
              Continuar para a redefinição
            </LinkButton>
          </div>
        )}
      </>
    );
  }

  const emailError = errors.email?.message;

  return (
    <>
      <StepHeader
        title="Redefinir senha"
        description="Informe o e-mail cadastrado. Se ele existir, enviaremos um link para criar uma nova senha."
      />
      <form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="E-mail" htmlFor="email" error={emailError} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="voce@empresa.com"
            autoFocus
            invalid={!!emailError}
            aria-describedby={describedBy('email', { error: emailError })}
            {...register('email', {
              required: 'E-mail é obrigatório',
              pattern: { value: EMAIL_PATTERN, message: 'Formato de e-mail inválido' },
            })}
          />
        </FormField>

        <FormErrorBanner id="mensagem" message={error} />

        <Button id="btnEnviar" type="submit" className="w-full" loading={isSubmitting}>
          Enviar link de redefinição
        </Button>

        <BackToLogin />
      </form>
    </>
  );
}

// ---- Etapa 2: definir a nova senha com o token ---------------------------------

interface ConfirmFormValues {
  newPassword: string;
  confirmPassword: string;
}

function ConfirmStep({ token }: { token: string }) {
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenRejected, setTokenRejected] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ConfirmFormValues>({ defaultValues: { newPassword: '', confirmPassword: '' } });

  const onSubmit = async (values: ConfirmFormValues) => {
    setFormError(null);
    setTokenRejected(false);
    try {
      const response = await api.confirmPasswordReset(token, values.newPassword);
      setDone(response.message);
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.code === 'SENHA_FRACA') {
        setError('newPassword', { type: 'server', message: apiError.message }, { shouldFocus: true });
      } else if (apiError.code === 'TOKEN_RESET_INVALIDO' || apiError.code === 'TOKEN_OBRIGATORIO') {
        setTokenRejected(true);
        setFormError('Este link de redefinição é inválido ou expirou. Solicite um novo.');
      } else {
        setFormError(errorMessage(err, 'Não foi possível redefinir a senha. Tente novamente.'));
      }
    }
  };

  if (done) {
    return (
      <SuccessPanel
        title="Senha redefinida"
        message={done}
        hint="Entre com a nova senha para continuar."
        action={{ to: '/login', label: 'Ir para o login' }}
      />
    );
  }

  const newPasswordError = errors.newPassword?.message;
  const confirmError = errors.confirmPassword?.message;

  return (
    <>
      <StepHeader
        title="Criar nova senha"
        description={`Mínimo de ${PASSWORD_MIN} caracteres, com letras maiúsculas e minúsculas, um número e um símbolo.`}
      />
      <form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Nova senha" htmlFor="novaSenha" error={newPasswordError} required>
          <Input
            id="novaSenha"
            type="password"
            autoComplete="new-password"
            autoFocus
            invalid={!!newPasswordError}
            aria-describedby={describedBy('novaSenha', { error: newPasswordError })}
            {...register('newPassword', {
              required: 'Nova senha é obrigatória',
              minLength: {
                value: PASSWORD_MIN,
                message: `A senha deve ter no mínimo ${PASSWORD_MIN} caracteres`,
              },
              maxLength: {
                value: PASSWORD_MAX,
                message: `A senha deve ter no máximo ${PASSWORD_MAX} caracteres`,
              },
            })}
          />
        </FormField>

        <FormField label="Confirmar nova senha" htmlFor="confirmarSenha" error={confirmError} required>
          <Input
            id="confirmarSenha"
            type="password"
            autoComplete="new-password"
            invalid={!!confirmError}
            aria-describedby={describedBy('confirmarSenha', { error: confirmError })}
            {...register('confirmPassword', {
              required: 'Confirme a nova senha',
              validate: (value) => value === getValues('newPassword') || 'As senhas não conferem',
            })}
          />
        </FormField>

        <FormErrorBanner id="mensagem" message={formError} />

        <Button id="btnRedefinir" type="submit" className="w-full" loading={isSubmitting}>
          Redefinir senha
        </Button>

        {tokenRejected ? (
          <div className="text-center">
            <Link
              to="/reset-password"
              className="inline-flex items-center gap-1 text-sm font-medium text-ink underline-offset-4 hover:underline dark:text-white"
            >
              Solicitar um novo link
            </Link>
          </div>
        ) : (
          <BackToLogin />
        )}
      </form>
    </>
  );
}

// ---- Capacidade desligada -----------------------------------------------------

function UnavailableStep() {
  return (
    <>
      <StepHeader title="Redefinir senha" />
      <div className="mt-6 space-y-5">
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300"
        >
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          <p>
            A redefinição de senha por e-mail não está disponível nesta instalação. Contate o administrador.
          </p>
        </div>
        <LinkButton to="/login" variant="outline" className="w-full" leftIcon={<ArrowLeftIcon size={16} />}>
          Voltar ao login
        </LinkButton>
      </div>
    </>
  );
}
