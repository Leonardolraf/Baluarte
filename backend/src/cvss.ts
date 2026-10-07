// Nota base CVSS v3.1 calculada a partir do vetor (especificacao FIRST, secao 7).
// Com vetor, a nota sai daqui e a severidade sai da nota: os tres nunca se contradizem.

const PESOS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

const METRICAS = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'] as const;
const VALORES: Record<(typeof METRICAS)[number], readonly string[]> = {
  AV: ['N', 'A', 'L', 'P'],
  AC: ['L', 'H'],
  PR: ['N', 'L', 'H'],
  UI: ['N', 'R'],
  S: ['U', 'C'],
  C: ['H', 'L', 'N'],
  I: ['H', 'L', 'N'],
  A: ['H', 'L', 'N'],
};

/** Arredondamento para cima com 1 casa, como a especificacao define (evita erro de ponto flutuante). */
function roundup(x: number): number {
  const inteiro = Math.round(x * 100000);
  return inteiro % 10000 === 0 ? inteiro / 100000 : (Math.floor(inteiro / 10000) + 1) / 10;
}

/** Le `CVSS:3.1/AV:N/...`; devolve null se faltar, repetir ou sobrar metrica. */
function lerVetor(vetor: string): Record<(typeof METRICAS)[number], string> | null {
  const partes = vetor.trim().split('/');
  if (partes.shift() !== 'CVSS:3.1' || partes.length !== METRICAS.length) return null;
  const m: Partial<Record<(typeof METRICAS)[number], string>> = {};
  for (const parte of partes) {
    const [chave, valor] = parte.split(':') as [(typeof METRICAS)[number], string];
    if (!METRICAS.includes(chave) || m[chave] !== undefined || !VALORES[chave].includes(valor)) return null;
    m[chave] = valor;
  }
  return m as Record<(typeof METRICAS)[number], string>;
}

export function vetorCvssValido(vetor: unknown): vetor is string {
  return typeof vetor === 'string' && lerVetor(vetor) !== null;
}

/** Nota base (0.0 a 10.0) do vetor CVSS 3.1, ou null se o vetor for invalido. */
export function notaCvss(vetor: string): number | null {
  const m = lerVetor(vetor);
  if (!m) return null;
  const mudaEscopo = m.S === 'C';
  const pr = m.PR === 'N' ? 0.85 : m.PR === 'L' ? (mudaEscopo ? 0.68 : 0.62) : mudaEscopo ? 0.5 : 0.27;
  const c = PESOS.CIA[m.C as 'H'], i = PESOS.CIA[m.I as 'H'], a = PESOS.CIA[m.A as 'H'];
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impacto = mudaEscopo ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impacto <= 0) return 0;
  const exploracao = 8.22 * PESOS.AV[m.AV as 'N'] * PESOS.AC[m.AC as 'L'] * pr * PESOS.UI[m.UI as 'N'];
  return mudaEscopo ? roundup(Math.min(1.08 * (impacto + exploracao), 10)) : roundup(Math.min(impacto + exploracao, 10));
}

export function cweValido(cwe: unknown): cwe is string {
  return typeof cwe === 'string' && /^CWE-\d{1,5}$/.test(cwe);
}

export function cveValido(cve: unknown): cve is string {
  return typeof cve === 'string' && /^CVE-\d{4}-\d{4,7}$/.test(cve);
}
