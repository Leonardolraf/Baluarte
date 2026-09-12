import type { Request, Response } from 'express';

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

// Captura erros assincronos de um handler e devolve 500 padronizado.
export function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      console.error('[erro interno]', e);
      if (!res.headersSent) erro(res, 500, 'Erro interno no servidor', 'ERRO_INTERNO');
    });
  };
}

export function vazio(v: unknown): boolean {
  return v === undefined || v === null || v === '';
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
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(h);
}

// Constantes de dominio (iguais ao stub)
export const TIPOS_ATIVO = ['Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'];
export const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
export const TEMPLATES = ['urgencia', 'autoridade', 'curiosidade'];
export const DOMINIO_INTERNO = '@empresa.com';

// Constantes de dominio das rotas adicionais (fora do contrato da N2 AT1)
export const STATUS_USUARIO = ['Ativo', 'Inativo', 'Pendente'];
export const STATUS_FINDING = ['Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'];
/** Status de achado que NAO contam como risco em aberto no dashboard. */
export const STATUS_FINDING_ENCERRADO = ['Resolvida', 'Risco aceito'];

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

// Classifica um CVSS (0.0–10.0) na faixa de severidade do projeto.
// Retorna os rotulos ACENTUADOS, exatamente como o contrato dos testes espera.
export function faixaCvss(cvss: number): 'Baixo' | 'Médio' | 'Alto' | 'Crítico' {
  if (cvss <= 3.9) return 'Baixo';
  if (cvss <= 6.9) return 'Médio';
  if (cvss <= 8.9) return 'Alto';
  return 'Crítico';
}
