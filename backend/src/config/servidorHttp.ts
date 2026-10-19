import { createServer, type Server } from 'node:http';
import type { Express } from 'express';

/**
 * Opcoes do servidor HTTP da API. `requestTimeout: 0` desliga o prazo global do Node para
 * receber a requisicao inteira, porque ele nao tem excecao por rota: o prazo continua valendo,
 * de 5 min, aplicado pelo middleware `tempoTotalDaRequisicao` (middlewares/tempoRequisicao),
 * e so a analise de arquivos o troca por ociosidade.
 *
 * `headersTimeout` precisa vir explicito: o padrao do Node e o menor entre 60 s e o
 * `requestTimeout`, entao com `requestTimeout: 0` ele tambem viraria 0 e cabecalhos mandados aos
 * poucos (o slow-loris classico) nunca seriam cortados. Fica nos mesmos 60 s de antes.
 */
export const OPCOES_SERVIDOR_HTTP = { requestTimeout: 0, headersTimeout: 60_000 } as const;

/** Cria e poe o servidor para escutar (producao e testes usam o mesmo, com as mesmas opcoes). */
export function escutar(app: Express, porta: number, host?: string): Promise<Server> {
  const servidor = createServer(OPCOES_SERVIDOR_HTTP, app);
  return new Promise((ok, falha) => {
    servidor.once('error', falha);
    const pronto = () => {
      servidor.off('error', falha);
      ok(servidor);
    };
    if (host) servidor.listen(porta, host, pronto);
    else servidor.listen(porta, pronto);
  });
}
