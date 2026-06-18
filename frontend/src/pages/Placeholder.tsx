export function Placeholder({ titulo }: { titulo: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">{titulo}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
        Tela em construção — será gerada a partir do Figma na etapa M4.
      </div>
    </div>
  );
}
