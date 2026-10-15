import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { TermsOfUse } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { errorMessage, isHttpError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { notify, trackOperation } from '@/store/uiStore';
import { Button, Card, ErrorState, FormErrorBanner, LoadingSpinner, PageHeader } from '@/components';
import { AlertTriangleIcon } from '@/components/icons';

// Melhorias #5 — aceite dos termos de uso.
//
// Enquanto não há aceite, a API recusa toda rota autenticada com 403 TERMOS_NAO_ACEITOS e
// só deixa passar login, logout, renovação de sessão e estas duas rotas. Esta tela é a
// única saída desse estado, então ela não pode depender de nada que exija aceite.
//
// RASCUNHO: o texto em vigor ainda é espaço reservado (o definitivo vem do Leo). A tela diz
// isso em destaque — apresentar um texto provisório como termo válido seria afirmar o que
// não é, e aceite é justamente o ato em que a pessoa confia no que está escrito.

/** Para onde voltar depois de aceitar: a rota que disparou o 403, ou o dashboard. */
function destinoDepoisDoAceite(state: unknown): string {
  const from = (state as { from?: { pathname?: string } } | null)?.from?.pathname;
  return from && from !== '/termos' ? from : '/dashboard';
}

export default function TermsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, error, loading, reload } = useAsync<TermsOfUse>(() => api.getTerms(), []);

  if (!data) {
    if (error)
      return (
        <ErrorState
          status={error.status}
          message={error.message}
          onRetry={() => void reload()}
          retrying={loading}
        />
      );
    return <LoadingSpinner label="Carregando os termos…" />;
  }

  async function aceitar(): Promise<void> {
    if (!data) return;
    setSubmitError(null);
    setSaving(true);
    try {
      await trackOperation(api.acceptTerms(data.version));
      notify.success('Termos de uso aceitos');
      navigate(destinoDepoisDoAceite(location.state), { replace: true });
    } catch (err) {
      // 409: o texto mudou desde a leitura. Recarrega para a pessoa aceitar o que está em
      // vigor — aceitar um texto que ela não viu seria o oposto do que o aceite significa.
      if (isHttpError(err) && err.code === 'VERSAO_DESATUALIZADA') {
        setChecked(false);
        setSubmitError('Os termos mudaram enquanto você lia. Leia a versão atual abaixo e aceite de novo.');
        void reload();
      } else {
        setSubmitError(errorMessage(err, 'Não foi possível registrar o aceite.'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Termos de uso"
        description="Leia e aceite para continuar usando a plataforma."
        meta={<span className="text-sm text-slate-600 dark:text-slate-300">Versão {data.version}</span>}
      />

      {data.draft && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="termos-rascunho"
        >
          <AlertTriangleIcon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>Texto provisório.</strong> Esta versão ainda não foi aprovada e serve apenas para o
            sistema funcionar durante o desenvolvimento. Quando o texto definitivo entrar em vigor, o aceite
            será pedido de novo.
          </p>
        </div>
      )}

      <Card title="Termos de uso da plataforma">
        <p
          className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200"
          data-testid="termos-texto"
        >
          {data.text}
        </p>
      </Card>

      <FormErrorBanner message={submitError} />

      {data.accepted ? (
        <Card>
          <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="termos-aceito">
            Você aceitou estes termos
            {data.acceptedAt ? ` em ${formatDateTime(data.acceptedAt)}` : ''}.
          </p>
          <div className="mt-3">
            <Button variant="outline" onClick={() => navigate('/dashboard')}>
              Ir ao dashboard
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <label className="flex items-start gap-3 text-sm text-ink dark:text-white">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              data-testid="termos-checkbox"
            />
            <span>Li e aceito os termos de uso na versão {data.version}.</span>
          </label>
          <div className="mt-4">
            <Button
              // Sem a marcação não há aceite: o botão desabilitado é a trava da tela, e a
              // API ainda exige a versão lida no corpo.
              disabled={!checked}
              loading={saving}
              onClick={() => void aceitar()}
              data-testid="termos-aceitar"
            >
              Aceitar e continuar
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
