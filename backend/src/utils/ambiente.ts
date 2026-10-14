/**
 * Tempo em milissegundos vindo do ambiente, lido a cada chamada (os testes trocam o valor sem
 * recarregar o modulo). Vazio, zero, negativo, texto ou infinito voltam ao padrao: `Number('')`
 * e 0, e zero num tempo limite costuma significar "desligado", o oposto do que se quer.
 */
export function msDoAmbiente(nome: string, padrao: number): number {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}
