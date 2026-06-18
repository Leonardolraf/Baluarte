import { useEffect, useState } from 'react';
import { api } from '../../api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface PoliticaSenha {
  comprimentoMinimo: number;
  exigirMaiusculaMinuscula: boolean;
  exigirNumeroEspecial: boolean;
}

interface Sessao {
  algoritmoToken: string;
  expiracaoMinutos: number;
  limiteTentativasLogin: number;
  doisFatores: boolean;
}

interface Auditoria {
  logImutavel: boolean;
  retencaoMeses: number;
}

interface ConfiguracoesDados {
  politicaSenha: PoliticaSenha;
  sessao: Sessao;
  auditoria: Auditoria;
}

// ---------------------------------------------------------------------------
// Sub-componentes de display
// ---------------------------------------------------------------------------

/** Toggle visual read-only: azul = on, cinza = off */
function Toggle({ id, valor }: { id: string; valor: boolean }) {
  return (
    <div
      id={id}
      role="status"
      aria-label={valor ? 'Ativado' : 'Desativado'}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors ${valor ? 'bg-brand' : 'bg-slate-300'}`}
    >
      <span
        className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-transform ${valor ? 'translate-x-[20px]' : 'translate-x-[2px]'}`}
      />
    </div>
  );
}

/** Campo de valor read-only (números, strings) */
function Campo({ id, valor }: { id: string; valor: string }) {
  return (
    <div
      id={id}
      className="flex h-[32px] w-[168px] shrink-0 items-center rounded-lg border border-slate-200 bg-[#f8fafc] px-3"
    >
      <span className="text-[13px] font-medium text-ink">{valor}</span>
    </div>
  );
}

/** Linha de configuração com label à esquerda e controle à direita */
function LinhaConfig({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div id={id} className="flex items-center justify-between py-3 border-t border-slate-100 first:border-t-0">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Abas de navegação lateral
// ---------------------------------------------------------------------------
type Aba = 'geral' | 'seguranca' | 'notificacoes' | 'integracoes' | 'conta';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'geral', label: 'Geral' },
  { id: 'seguranca', label: 'Segurança' },
  { id: 'notificacoes', label: 'Notificações' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'conta', label: 'Conta & LGPD' },
];

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Configuracoes() {
  const [dados, setDados] = useState<ConfiguracoesDados | null>(null);
  const [erro, setErro] = useState('');
  const [abaAtiva, setAbaAtiva] = useState<Aba>('seguranca');

  useEffect(() => {
    api
      .get('/configuracoes/seguranca')
      .then((r) => setDados(r.dados))
      .catch((e: Error) => setErro(e.message));
  }, []);

  return (
    <div>
      {/* Cabeçalho da página */}
      <h1 id="cfg-titulo" className="text-2xl font-bold text-ink">
        Configurações
      </h1>
      <p id="cfg-subtitulo" className="mt-1 text-sm text-slate-500">
        Parâmetros de segurança, sessão e conformidade da plataforma
      </p>

      <div className="mt-6 flex gap-6 items-start">
        {/* Navegação lateral */}
        <nav
          id="cfg-nav"
          className="w-[236px] shrink-0 rounded-xl border border-slate-200 bg-white p-2"
          aria-label="Seções de configuração"
        >
          {ABAS.map((aba) => {
            const ativa = abaAtiva === aba.id;
            return (
              <button
                key={aba.id}
                id={`cfg-nav-${aba.id}`}
                type="button"
                onClick={() => setAbaAtiva(aba.id)}
                className={`w-full rounded-lg px-[14px] py-[10px] text-left text-[13px] transition-colors ${
                  ativa
                    ? 'bg-[#eff6ff] font-semibold text-brand'
                    : 'font-medium text-slate-500 hover:bg-slate-50'
                }`}
              >
                {aba.label}
              </button>
            );
          })}
        </nav>

        {/* Conteúdo principal */}
        <div id="cfg-conteudo" className="flex-1 min-w-0">
          {/* Estado de erro */}
          {erro && (
            <div id="cfg-erro" className="rounded-xl border border-sev-critico bg-red-50 p-4 text-sm text-sev-critico">
              Erro ao carregar configurações: {erro}
            </div>
          )}

          {/* Estado de carregando */}
          {!erro && !dados && (
            <div id="cfg-carregando" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              Carregando configurações…
            </div>
          )}

          {/* Aba Segurança */}
          {!erro && dados && abaAtiva === 'seguranca' && (
            <div id="cfg-aba-seguranca" className="flex flex-col gap-4">

              {/* Card 1 — Política de senhas */}
              <section
                id="card-politica-senha"
                className="rounded-xl border border-slate-200 bg-white p-5"
                aria-labelledby="card-politica-senha-titulo"
              >
                <h2
                  id="card-politica-senha-titulo"
                  className="text-[15px] font-semibold text-ink"
                >
                  Política de senhas
                </h2>
                <p className="mt-1 text-[12px] text-slate-400">
                  Aplicada no cadastro e na troca de senha (RN-001 · base NIST SP 800-63B).
                </p>

                <div className="mt-4">
                  <LinhaConfig id="cfg-comprimento-minimo" label="Comprimento mínimo">
                    <Campo
                      id="cfg-comprimento-minimo-valor"
                      valor={`${dados.politicaSenha.comprimentoMinimo} caracteres`}
                    />
                  </LinhaConfig>

                  <LinhaConfig id="cfg-exigir-maiuscula" label="Exigir letra maiúscula e minúscula">
                    <Toggle
                      id="cfg-exigir-maiuscula-toggle"
                      valor={dados.politicaSenha.exigirMaiusculaMinuscula}
                    />
                  </LinhaConfig>

                  <LinhaConfig id="cfg-exigir-especial" label="Exigir número e caractere especial">
                    <Toggle
                      id="cfg-exigir-especial-toggle"
                      valor={dados.politicaSenha.exigirNumeroEspecial}
                    />
                  </LinhaConfig>
                </div>
              </section>

              {/* Card 2 — Autenticação & sessão */}
              <section
                id="card-autenticacao-sessao"
                className="rounded-xl border border-slate-200 bg-white p-5"
                aria-labelledby="card-autenticacao-sessao-titulo"
              >
                <h2
                  id="card-autenticacao-sessao-titulo"
                  className="text-[15px] font-semibold text-ink"
                >
                  Autenticação &amp; sessão
                </h2>

                <div className="mt-4">
                  <LinhaConfig id="cfg-algoritmo-token" label="Algoritmo de assinatura do token">
                    <div
                      id="cfg-algoritmo-token-valor"
                      className="flex h-[32px] w-[168px] shrink-0 items-center rounded-lg bg-slate-100 px-3"
                    >
                      <span className="text-[12px] font-medium text-slate-500">
                        {dados.sessao.algoritmoToken} 🔒
                      </span>
                    </div>
                  </LinhaConfig>

                  <LinhaConfig id="cfg-expiracao-token" label="Expiração do access token">
                    <Campo
                      id="cfg-expiracao-token-valor"
                      valor={`${dados.sessao.expiracaoMinutos} minutos`}
                    />
                  </LinhaConfig>

                  <LinhaConfig id="cfg-limite-tentativas" label="Bloquear conta após (US-007)">
                    <Campo
                      id="cfg-limite-tentativas-valor"
                      valor={`${dados.sessao.limiteTentativasLogin} tentativas`}
                    />
                  </LinhaConfig>

                  <LinhaConfig id="cfg-dois-fatores" label="Autenticação em duas etapas (2FA)">
                    <Toggle
                      id="cfg-dois-fatores-toggle"
                      valor={dados.sessao.doisFatores}
                    />
                  </LinhaConfig>
                </div>
              </section>

              {/* Card 3 — Auditoria & conformidade */}
              <section
                id="card-auditoria-conformidade"
                className="rounded-xl border border-slate-200 bg-white p-5"
                aria-labelledby="card-auditoria-conformidade-titulo"
              >
                <h2
                  id="card-auditoria-conformidade-titulo"
                  className="text-[15px] font-semibold text-ink"
                >
                  Auditoria &amp; conformidade
                </h2>

                <div className="mt-4">
                  <LinhaConfig id="cfg-log-imutavel" label="Log de auditoria imutável (RN-008)">
                    <Toggle
                      id="cfg-log-imutavel-toggle"
                      valor={dados.auditoria.logImutavel}
                    />
                  </LinhaConfig>

                  <LinhaConfig id="cfg-retencao-logs" label="Retenção de logs">
                    <Campo
                      id="cfg-retencao-logs-valor"
                      valor={`${dados.auditoria.retencaoMeses} meses`}
                    />
                  </LinhaConfig>
                </div>

                <p className="mt-3 text-[11px] text-slate-400">
                  Dados de colaboradores processados apenas dentro da organização (LGPD · RN-004, RN-006).
                </p>
              </section>
            </div>
          )}

          {/* Abas ainda não implementadas */}
          {abaAtiva !== 'seguranca' && (
            <div
              id={`cfg-aba-${abaAtiva}`}
              className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400"
            >
              Esta seção ainda não está disponível.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
