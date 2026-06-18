import type { ReactNode } from 'react';

export function FormShell({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-sm font-bold text-white">B</div>
          <span className="font-semibold text-ink">Baluarte</span>
        </div>
        <h1 className="text-2xl font-bold text-ink">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-slate-500">{subtitulo}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function Campo({ id, label, tipo = 'text', valor, onChange }: { id: string; label: string; tipo?: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-4 first:mt-0">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-brand"
      />
    </div>
  );
}

export function SelectCampo({ id, label, valor, onChange, opcoes }: { id: string; label: string; valor: string; onChange: (v: string) => void; opcoes: { valor: string; texto: string }[] }) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm outline-none focus:border-brand"
      >
        <option value="">Selecione…</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
    </div>
  );
}

export function Botao({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button id={id} type="submit" className="mt-6 h-12 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:bg-brand-dark">
      {children}
    </button>
  );
}

export function Mensagem({ texto, ok }: { texto: string; ok: boolean }) {
  if (!texto) return null;
  return (
    <div id="mensagem" className={`mt-4 rounded-lg px-3 py-2 text-sm ${ok ? 'bg-green-50 text-sev-baixo' : 'bg-red-50 text-sev-critico'}`}>
      {texto}
    </div>
  );
}
