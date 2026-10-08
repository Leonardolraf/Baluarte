import type { Request, Response } from 'express';

// -----------------------------------------------------------------------------
// Envelope de resposta da API — espelha EXATAMENTE o contrato do stub da N2 AT1
// (mesmas mensagens e codigos de erro), para que as collections do Postman/Newman
// e as suites Robot continuem passando contra o sistema real.
// -----------------------------------------------------------------------------

export function agora(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function enviar(res: Response, status: number, obj: unknown): void {
  res.status(status).json(obj);
}

/**
 * Arquivo para download (ex.: o relatorio em PDF). `no-store`: o conteudo e do usuario
 * logado e nao deve ficar em cache de navegador ou proxy.
 */
export function enviarArquivo(res: Response, conteudo: Buffer, tipo: string, nomeArquivo: string): void {
  res
    .status(200)
    .set({
      'Content-Type': tipo,
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Content-Length': String(conteudo.length),
      'Cache-Control': 'no-store',
    })
    .end(conteudo);
}

export function erro(res: Response, status: number, mensagem: string, codigoErro: string): void {
  enviar(res, status, { status: 'erro', mensagem, codigoErro, timestamp: agora() });
}

/**
 * Regra de negocio violada. Services e controllers lancam; o `wrap` da rota devolve o
 * envelope de erro com o status, a mensagem e o codigo dados.
 */
export class ErroNegocio extends Error {
  constructor(
    readonly status: number,
    readonly mensagem: string,
    readonly codigo: string,
  ) {
    super(`${codigo}: ${mensagem}`);
  }
}

/** Atalho para os servicos: `falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO')`. */
export function falhar(status: number, mensagem: string, codigo: string): never {
  throw new ErroNegocio(status, mensagem, codigo);
}

// Envolve o controller: erros assincronos de regra de negocio viram o erro do contrato;
// qualquer outra excecao vira 500 padronizado, sem detalhe interno na resposta.
export function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      if (e instanceof ErroNegocio) {
        if (!res.headersSent) erro(res, e.status, e.mensagem, e.codigo);
        return;
      }
      console.error('[erro interno]', e);
      if (!res.headersSent) erro(res, 500, 'Erro interno no servidor', 'ERRO_INTERNO');
    });
  };
}
