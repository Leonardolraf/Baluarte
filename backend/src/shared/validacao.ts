// Validacoes de entrada compartilhadas pelas rotas (formato, nao regra de negocio) e a
// politica de senha publicada em GET /configuracoes/seguranca.

export function vazio(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/**
 * Texto obrigatorio: verdadeiro so quando `v` e uma string com conteudo apos o trim.
 * Recusa numero/booleano/objeto/array (que passariam por `vazio`) e string em branco,
 * antes de o valor chegar ao Prisma (senao vira 500 em vez de 400).
 */
export function textoPreenchido(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Coage um parametro de query string a `string | undefined`. O parser estendido do
 * Express transforma `?q[$ne]=x` ou `?campo[]=a` em objeto/array; sem esta coercao,
 * um `.toLowerCase()` nesse valor derruba o handler com 500.
 */
export function queryString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function emailFormatoValido(email: unknown): boolean {
  // 254 e o limite pratico de um endereco (RFC 5321); tambem impede chaves gigantes nos limitadores.
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hostValido(host: unknown): boolean {
  if (typeof host !== 'string' || host.trim() === '') return false;
  const h = host.trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = h.match(ipv4);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  // So digitos e pontos sem ser IPv4 (ex.: "10.0.0") nao e nome de dominio: o TLD nunca e numerico.
  if (/^[\d.]+$/.test(h)) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h);
}

// Politica de senha publicada em GET /configuracoes/seguranca e aplicada nas rotas
// de alteracao/redefinicao de senha.
export const POLITICA_SENHA = {
  comprimentoMinimo: 8,
  comprimentoMaximo: 64,
  exigirMaiusculaMinuscula: true,
  exigirNumeroEspecial: true,
} as const;

/** Valida uma senha nova contra a politica. Devolve a mensagem do problema ou null se estiver ok. */
export function validarSenha(senha: unknown): string | null {
  if (typeof senha !== 'string' || senha.length < POLITICA_SENHA.comprimentoMinimo)
    return `A nova senha deve ter no mínimo ${POLITICA_SENHA.comprimentoMinimo} caracteres`;
  if (senha.length > POLITICA_SENHA.comprimentoMaximo)
    return `A nova senha deve ter no máximo ${POLITICA_SENHA.comprimentoMaximo} caracteres`;
  if (POLITICA_SENHA.exigirMaiusculaMinuscula && !(/[a-z]/.test(senha) && /[A-Z]/.test(senha)))
    return 'A senha deve conter letras maiúsculas e minúsculas';
  if (POLITICA_SENHA.exigirNumeroEspecial && !(/\d/.test(senha) && /[^A-Za-z0-9]/.test(senha)))
    return 'A senha deve conter pelo menos um número e um símbolo';
  return null;
}
