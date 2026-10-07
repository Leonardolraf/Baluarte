import { createHash, randomBytes } from 'node:crypto';

// Tokens de uso externo (link de redefinicao de senha, link do e-mail de phishing).
// O token em claro so existe na mensagem entregue ao usuario; no banco fica o hash.

/** Token aleatorio de 256 bits, em hexadecimal. */
export function gerarTokenLink(): string {
  return randomBytes(32).toString('hex');
}

/** Hash SHA-256 (hex) — e o que se grava e o que se procura no banco. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
