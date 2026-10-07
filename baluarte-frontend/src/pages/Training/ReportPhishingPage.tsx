import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PhishingReportResult } from '@/types';
import { api } from '@/services/api';
import { errorMessage, isHttpError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { Button, FormErrorBanner, LinkButton } from '@/components';
import { AlertTriangleIcon, ArrowLeftIcon, CheckCircleIcon } from '@/components/icons';

// /t/:token/reportar — rodapé do e-mail simulado da campanha ("Achou este e-mail
// suspeito? Reporte aqui"). Abrir a página não registra nada: o reporte só vale com
// o clique em "Confirmar reporte" (POST). Assim, leitores de e-mail e antivírus que
// visitam os links antes da pessoa não "reportam" por ela. A API é idempotente.

export default function ReportPhishingPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [result, setResult] = useState<PhishingReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [sending, setSending] = useState(false);

  async function confirm() {
    setSending(true);
    setError(null);
    try {
      setResult(await api.reportPhishing(token));
    } catch (err) {
      if (isHttpError(err) && err.status === 404) setInvalid(true);
      else setError(errorMessage(err, 'Não foi possível registrar o reporte. Tente de novo.'));
    } finally {
      setSending(false);
    }
  }

  let content;
  if (result) {
    content = (
      <div className="flex flex-col items-center text-center" role="status">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-ink dark:bg-slate-700 dark:text-white">
          <CheckCircleIcon size={30} />
        </span>
        <h1 className="display mt-4 text-2xl text-ink dark:text-white">Reporte registrado</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Boa! Este e-mail era uma <strong>simulação de phishing</strong> do treinamento interno, e reportar é
          exatamente o que fazer com uma mensagem suspeita.
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Registrado em {formatDateTime(result.reportedAt)}.
        </p>
      </div>
    );
  } else if (invalid) {
    content = (
      <div className="flex flex-col items-center text-center" role="alert">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-ink dark:bg-slate-700 dark:text-white">
          <AlertTriangleIcon size={28} />
        </span>
        <h1 className="display mt-4 text-2xl text-ink dark:text-white">Link inválido</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          O link é inválido ou a campanha foi encerrada. Se recebeu um e-mail suspeito, avise a equipe de
          segurança pelos canais internos.
        </p>
        <LinkButton
          to="/login"
          variant="outline"
          className="mt-6 w-full"
          leftIcon={<ArrowLeftIcon size={16} />}
        >
          Ir para o login
        </LinkButton>
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-white dark:bg-white dark:text-ink">
          <AlertTriangleIcon size={24} />
        </span>
        <h1 className="display mt-4 text-2xl text-ink dark:text-white">Reportar e-mail suspeito</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Confirme para avisar a equipe de segurança sobre o e-mail que você recebeu. Nenhuma senha ou dado
          pessoal é pedido.
        </p>
        {error && <FormErrorBanner message={error} className="mt-4 w-full" />}
        <Button variant="primary" className="mt-6 w-full" loading={sending} onClick={confirm}>
          Confirmar reporte
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="surface w-full max-w-md p-6 sm:p-8">{content}</div>
    </div>
  );
}
