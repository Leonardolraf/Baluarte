import type { Response } from 'express';

// -----------------------------------------------------------------------------
// Helpers de resposta e validacao — espelham EXATAMENTE o contrato do stub da
// N2 AT1 (mesmas mensagens e codigos de erro), para que as collections do
// Postman/Newman e as suites Robot continuem passando contra o sistema real.
// -----------------------------------------------------------------------------

export function agora(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function enviar(res: Response, status: number, obj: unknown): void {
  res.status(status).json(obj);
}

export function erro(res: Response, status: number, mensagem: string, codigoErro: string): void {
  enviar(res, status, { status: 'erro', mensagem, codigoErro, timestamp: agora() });
}

export function vazio(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

export function emailFormatoValido(email: unknown): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hostValido(host: unknown): boolean {
  if (typeof host !== 'string' || host.trim() === '') return false;
  const h = host.trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = h.match(ipv4);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h);
}

// Constantes de dominio (iguais ao stub)
export const TIPOS_ATIVO = ['Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'];
export const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
export const TEMPLATES = ['urgencia', 'autoridade', 'curiosidade'];
export const DOMINIO_INTERNO = '@empresa.com';

// Classifica um CVSS (0.0–10.0) na faixa de severidade do projeto.
// Retorna os rotulos ACENTUADOS, exatamente como o contrato dos testes espera.
export function faixaCvss(cvss: number): 'Baixo' | 'Médio' | 'Alto' | 'Crítico' {
  if (cvss <= 3.9) return 'Baixo';
  if (cvss <= 6.9) return 'Médio';
  if (cvss <= 8.9) return 'Alto';
  return 'Crítico';
}
