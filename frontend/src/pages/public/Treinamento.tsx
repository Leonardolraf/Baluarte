import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api';

interface Treino {
  tipoAtaque: string;
  titulo: string;
  codigoModulo: string;
  duracaoMin: number;
  progresso: number;
  campanha: string | null;
  sinaisAlerta: string[];
  boasPraticas: string[];
}

// Tela publica de Treinamento Pos-Clique (Figma 3:2). Acessada pelo link da
// campanha simulada; consome GET /api/treinamentos/:token (endpoint publico).
export function Treinamento() {
  const { token } = useParams();
  const [t, setT] = useState<Treino | null>(null);
  const [erro, setErro] = useState('');
  const [reportado, setReportado] = useState(false);

  useEffect(() => {
    api.get('/treinamentos/' + token).then((r) => setT(r.dados)).catch((e) => setErro(e.message));
  }, [token]);

  if (erro) return <div className="p-8 text-sev-critico">Erro: {erro}</div>;
  if (!t) return <div className="p-8 text-slate-500">Carregando treinamento…</div>;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand text-sm font-bold text-white">B</div>
        <span className="font-semibold text-ink">Baluarte</span>
        <span className="ml-2 text-sm text-slate-400">· Treinamento de conscientização</span>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {/* Banner de alerta */}
        <div id="bannerAlerta" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠️ Você clicou em um link de <strong>phishing simulado</strong>{t.campanha ? ` da campanha "${t.campanha}"` : ''}. Calma — foi um teste interno. Aproveite para aprender a reconhecer o golpe.
        </div>

        {/* Cabeçalho do módulo */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span id="badgeTipoAtaque" className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">{t.tipoAtaque}</span>
          <span id="badgeDuracaoModulo" className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">{t.duracaoMin} min de leitura</span>
          {t.campanha && <span id="badgeCampanhaAtiva" className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">{t.campanha}</span>}
        </div>
        <h1 id="txtTituloModulo" className="mt-3 text-2xl font-bold text-ink">{t.titulo}</h1>
        <p id="txtCodigoModulo" className="text-sm text-slate-400">Módulo {t.codigoModulo}</p>

        {/* Progresso */}
        <div className="mt-3">
          <div className="h-2 rounded-full bg-slate-200">
            <div id="progressoTreinamento" className="h-2 rounded-full bg-brand" style={{ width: `${t.progresso}%` }} />
          </div>
          <span id="txtPercentualProgresso" className="text-xs text-slate-400">{t.progresso}% concluído</span>
        </div>

        {/* Conteúdo educativo */}
        <div id="cardConteudoEducativo" className="mt-6 grid gap-4 sm:grid-cols-2">
          <div id="calloutSinaisAlerta" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-sev-critico">Sinais de alerta</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {t.sinaisAlerta.map((s, i) => <li key={i}>• {s}</li>)}
            </ul>
          </div>
          <div id="calloutBoaPratica" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-sev-baixo">Boas práticas</h2>
            <ul id="listaAcoesRecomendadas" className="mt-2 space-y-1 text-sm text-slate-600">
              {t.boasPraticas.map((s, i) => <li key={i}>✓ {s}</li>)}
            </ul>
          </div>
        </div>

        {/* Quiz + ações */}
        <div id="cardQuiz" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <div className="text-sm font-semibold text-ink">Pronto para testar o que aprendeu?</div>
            <div className="text-xs text-slate-500">1 quiz rápido ao final do módulo.</div>
          </div>
          <button id="btnIniciarQuiz" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Iniciar quiz →</button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            id="btnReportarTI"
            onClick={() => setReportado(true)}
            className="text-sm font-medium text-brand hover:underline"
          >
            {reportado ? '✓ Reportado ao time de TI' : 'Reportar e-mail suspeito ao time de TI'}
          </button>
          <Link id="btnVoltarMenu" to="/login" className="text-sm text-slate-500 hover:text-ink">← Voltar</Link>
        </div>
      </main>
    </div>
  );
}
