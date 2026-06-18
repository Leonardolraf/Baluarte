import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import type { ApiError } from '../api';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [logado, setLogado] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setMensagem('');
    setErro(false);
    setCarregando(true);
    try {
      await login(email, senha);
      setMensagem('Login realizado com sucesso');
      // Nao redireciona automaticamente: mostra sucesso + botao manual, para que
      // a suite Robot (que faz Reload Page entre os casos) continue na tela de login.
      setLogado(true);
    } catch (err) {
      setErro(true);
      setMensagem((err as ApiError)?.message || 'Falha ao autenticar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* BrandPanel */}
      <div className="hidden w-[520px] flex-shrink-0 flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-brand text-2xl font-bold">B</div>
          <span className="text-xl font-semibold">Baluarte</span>
        </div>
        <div>
          <h1 className="text-[32px] font-semibold leading-tight">Segurança ofensiva e conscientização numa plataforma só.</h1>
          <p className="mt-4 text-[15px] text-slate-300">Varredura OWASP Top 10 · Phishing simulado · Dashboard unificado</p>
        </div>
        <p className="text-[13px] text-slate-500">UCB · TCC Engenharia de Software</p>
      </div>

      {/* FormPanel */}
      <div className="flex flex-1 items-center justify-center bg-white px-6">
        <form id="formLogin" onSubmit={entrar} noValidate className="w-full max-w-sm">
          <h2 className="text-3xl font-bold text-ink">Entrar</h2>
          <p className="mt-1 text-[15px] text-slate-500">Acesse o painel da sua organização.</p>

          <label htmlFor="email" className="mt-6 block text-sm font-medium text-slate-700">E-mail</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
            className="mt-1 h-12 w-full rounded-[10px] border border-slate-300 bg-slate-50 px-4 text-sm outline-none focus:border-brand"
          />

          <label htmlFor="senha" className="mt-4 block text-sm font-medium text-slate-700">Senha</label>
          <input
            id="senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
            className="mt-1 h-12 w-full rounded-[10px] border border-slate-300 bg-slate-50 px-4 text-sm outline-none focus:border-brand"
          />

          <div className="mt-2 text-right">
            <a id="linkEsqueciSenha" href="#" className="text-sm font-medium text-brand">Esqueci a senha</a>
          </div>

          <button
            id="btnEntrar"
            type="submit"
            disabled={carregando}
            className="mt-5 h-[52px] w-full rounded-[10px] bg-brand text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>

          {mensagem && (
            <div id="mensagem" className={`mt-4 rounded-lg px-3 py-2 text-sm ${erro ? 'bg-red-50 text-sev-critico' : 'bg-green-50 text-sev-baixo'}`}>
              {mensagem}
            </div>
          )}

          {logado && (
            <button
              type="button"
              id="btnIrPainel"
              onClick={() => navigate('/')}
              className="mt-3 h-11 w-full rounded-[10px] border border-brand text-sm font-semibold text-brand hover:bg-blue-50"
            >
              Ir para o painel →
            </button>
          )}

          <p className="mt-6 text-xs text-slate-400">Perfis: Administrador · Analista de Segurança · Colaborador</p>
        </form>
      </div>
    </div>
  );
}
