import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, type Location } from 'react-router-dom';
import type { RBACRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { USE_MOCKS } from '@/services/api';
import { errorMessage } from '@/lib/errors';
import { ROLE_LABEL } from '@/lib/roles';
import { notify } from '@/store/uiStore';
import { Button, FormErrorBanner, FormField, Input, describedBy } from '@/components';
import { EyeIcon, ShieldIcon, type IconProps } from '@/components/icons';

interface LoginFormValues {
  email: string;
  senha: string;
}

/** Estado gravado pelo `ProtectedRoute` ao redirecionar um anônimo para o login. */
interface RedirectState {
  from?: Partial<Location> | null;
}

/** Conta fictícia do ambiente mock, carregada sob demanda de `src/mocks/data.ts`. */
interface DemoCredential {
  email: string;
  password: string;
  role: RBACRole;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Variante "olho riscado" (não existe em `@/components/icons`); mesmo traço do `EyeIcon`. */
function EyeOffIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoCredential[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ defaultValues: { email: '', senha: '' } });

  // As credenciais de demonstração ficam no módulo de mocks, carregado por `import()`
  // apenas quando `USE_MOCKS` está ativo — assim não entram no bundle de produção.
  useEffect(() => {
    if (!USE_MOCKS) return undefined;
    let cancelled = false;
    void import('@/mocks/data')
      .then((module) => {
        if (cancelled) return;
        setDemo(
          module.MOCK_CREDENTIALS.flatMap((credential) => {
            const user = module.MOCK_USERS.find((candidate) => candidate.id === credential.userId);
            return user ? [{ email: credential.email, password: credential.password, role: user.role }] : [];
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const redirectState = location.state as RedirectState | null;
  const from = redirectState?.from;
  const destination = from?.pathname
    ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
    : '/dashboard';

  if (isAuthenticated) {
    return <Navigate to={destination} replace />;
  }

  const onSubmit = async (values: LoginFormValues) => {
    setMessage(null);
    try {
      await login({ email: values.email.trim(), password: values.senha });
      notify.success('Login realizado com sucesso');
      navigate(destination, { replace: true });
    } catch (err) {
      setMessage(errorMessage(err, 'Não foi possível entrar. Tente novamente.'));
    }
  };

  const fillCredentials = (credential: DemoCredential) => {
    setMessage(null);
    setValue('email', credential.email, { shouldValidate: true, shouldDirty: true });
    setValue('senha', credential.password, { shouldValidate: true, shouldDirty: true });
  };

  const emailError = errors.email?.message;
  const senhaError = errors.senha?.message;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="surface w-full max-w-md p-8">
        <header className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-white">
            <ShieldIcon size={26} />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-ink dark:text-white">Entrar no Baluarte</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Acesse o painel unificado de risco técnico e humano da sua empresa.
          </p>
        </header>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
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

          <FormField label="Senha" htmlFor="senha" error={senhaError} required>
            <div className="relative">
              <Input
                id="senha"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className="pr-11"
                invalid={!!senhaError}
                aria-describedby={describedBy('senha', { error: senhaError })}
                {...register('senha', { required: 'Senha é obrigatória' })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
              >
                {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
          </FormField>

          <FormErrorBanner id="mensagem" message={message} />

          <Button id="btnEntrar" type="submit" className="w-full" loading={isSubmitting}>
            Entrar
          </Button>

          <div className="text-center">
            <Link
              to="/reset-password"
              className="text-sm font-medium text-brand hover:underline dark:text-blue-400"
            >
              Esqueci minha senha
            </Link>
          </div>
        </form>

        {demo.length > 0 && (
          <aside
            aria-labelledby="demo-title"
            className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50"
          >
            <p id="demo-title" className="label-caps">
              Ambiente de demonstração
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Nenhum backend está conectado. Use uma das contas fictícias abaixo para explorar cada perfil.
            </p>
            <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
              {demo.map((credential) => (
                <li key={credential.email} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-ink dark:text-slate-100">
                      {credential.email}
                      <span className="text-slate-400 dark:text-slate-500"> / </span>
                      {credential.password}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {ROLE_LABEL[credential.role]}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fillCredentials(credential)}
                    aria-label={`Usar ${ROLE_LABEL[credential.role]} (${credential.email})`}
                  >
                    Usar
                  </Button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
