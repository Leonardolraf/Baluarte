// Regras de validacao do frontend — espelham as do backend (util.ts) para que
// os formularios produzam exatamente as mesmas mensagens dos testes.

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hostValido(host: string): boolean {
  if (!host || !host.trim()) return false;
  const h = host.trim();
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h);
}

// Hosts ja cadastrados no seed (para a regra de duplicidade no cadastro de ativo).
export const HOSTS_EXISTENTES = ['192.168.0.10', '192.168.0.20'];

export const DOMINIO_INTERNO = '@empresa.com';
