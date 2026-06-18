import { Link } from 'react-router-dom';

// Tela publica institucional (Figma 3:90). Conteudo estatico (landing).
const STATS = [
  { id: 'stat-custo-violacao', valor: 'US$ 4,45M', rotulo: 'Custo médio de uma violação de dados', fonte: 'IBM, 2023' },
  { id: 'stat-fator-humano', valor: '74%', rotulo: 'das violações envolvem o fator humano', fonte: 'Verizon DBIR 2023' },
  { id: 'stat-ataques-brasil', valor: '103 Bi', rotulo: 'tentativas de ataque no Brasil (1º sem.)', fonte: 'Fortinet, 2023' },
];

const FEATURES = [
  { id: 'card-owasp', titulo: 'Varredura OWASP Top 10', desc: 'Identifica e classifica vulnerabilidades web por severidade (CVSS).' },
  { id: 'card-phishing', titulo: 'Phishing Simulado', desc: 'Campanhas controladas que medem a maturidade dos colaboradores.' },
  { id: 'card-dashboard', titulo: 'Dashboard Unificado', desc: 'Risco técnico e humano consolidados num painel só.' },
  { id: 'card-treinamento', titulo: 'Treinamento Contextual', desc: 'Redirecionamento educativo imediato após o clique.' },
];

const EQUIPE = [
  { id: 'avatar-leonardo', nome: 'Leonardo R.', papel: 'Dev & Design' },
  { id: 'avatar-edson', nome: 'Edson M.', papel: 'Documentação' },
  { id: 'avatar-equipe', nome: 'Baluarte 2026', papel: 'TCC · UCB' },
];

export function QuemSomos() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <header id="navbar" className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div id="logo-baluarte" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand text-sm font-bold text-white">B</div>
          <span className="font-semibold text-ink">Baluarte</span>
        </div>
        <nav className="hidden gap-6 text-sm text-slate-600 md:flex">
          <a id="nav-sobre" href="#sobre" className="hover:text-ink">Sobre</a>
          <a id="nav-funcionalidades" href="#funcionalidades" className="hover:text-ink">Funcionalidades</a>
          <a id="nav-seguranca" href="#sobre" className="hover:text-ink">Segurança</a>
          <a id="nav-contato" href="#sobre" className="hover:text-ink">Contato</a>
        </nav>
        <Link id="btnSolicitarAcesso" to="/login" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          Entrar
        </Link>
      </header>

      {/* Hero */}
      <section id="hero-section" className="bg-ink px-6 py-20 text-center text-white">
        <h1 id="hero-headline" className="mx-auto max-w-3xl text-4xl font-bold leading-tight">
          Segurança ofensiva e conscientização numa plataforma só.
        </h1>
        <p id="hero-subtitulo" className="mx-auto mt-4 max-w-xl text-slate-300">
          O Baluarte reúne varredura de vulnerabilidades e phishing simulado para reduzir, ao mesmo tempo, o risco técnico e o risco humano de empresas de médio porte.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link id="btnSolicitarDemo" to="/login" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Acessar o painel</Link>
          <a id="btnVerDocumentacao" href="https://github.com/Leonardolraf/Baluarte/wiki" className="rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Ver documentação</a>
        </div>
      </section>

      {/* Estatísticas */}
      <section className="grid gap-6 px-6 py-14 sm:grid-cols-3">
        {STATS.map((s) => (
          <div key={s.id} id={s.id} className="text-center">
            <div className="text-3xl font-bold text-brand">{s.valor}</div>
            <div className="mt-1 text-sm text-slate-600">{s.rotulo}</div>
            <div className="text-xs text-slate-400">{s.fonte}</div>
          </div>
        ))}
      </section>

      {/* Funcionalidades */}
      <section id="secao-funcionalidades" className="bg-slate-50 px-6 py-14">
        <h2 className="text-center text-2xl font-bold text-ink">O que a plataforma faz</h2>
        <div className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.id} id={f.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-ink">{f.titulo}</div>
              <div className="mt-1 text-sm text-slate-500">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Quem somos */}
      <section id="secao-quem-somos" className="px-6 py-14">
        <h2 className="text-center text-2xl font-bold text-ink">Quem somos</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-500">
          Projeto final de Engenharia de Software na Universidade Católica de Brasília.
        </p>
        <div className="mx-auto mt-8 flex max-w-2xl flex-wrap justify-center gap-8">
          {EQUIPE.map((m) => (
            <div key={m.id} id={m.id} className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-lg font-bold text-brand">
                {m.nome.slice(0, 1)}
              </div>
              <div className="mt-2 text-sm font-semibold text-ink">{m.nome}</div>
              <div className="text-xs text-slate-400">{m.papel}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 px-6 py-6 text-center text-xs text-slate-400">
        Baluarte · UCB · TCC de Engenharia de Software · 2026
      </footer>
    </div>
  );
}
