import type { NextFunction, Request, Response } from 'express';
import { msDoAmbiente } from '../utils/ambiente.js';

// Tempo para receber o corpo da requisicao (defesa contra o slow-loris, que segura conexoes
// mandando o corpo aos poucos). O `requestTimeout` do Node vale para o servidor inteiro (5 min
// para receber a requisicao toda) e nao tem excecao por rota; o envio de arquivo de 250 MB numa
// conexao lenta, porem estavel, passaria disso. Por isso o servidor sobe com `requestTimeout: 0`
// (config/servidorHttp.ts) e a mesma regra e aplicada aqui, a toda requisicao, com uma unica
// excecao: a analise de arquivos, DEPOIS de autenticar e reservar a vaga, troca o total por um
// tempo de ociosidade (`trocarPorOciosidade`). Cabecalhos continuam com o `headersTimeout`
// padrao do Node (60 s), que nao foi mexido.

/** Total para receber o corpo, como o `requestTimeout` padrao do Node. */
export const TEMPO_TOTAL_PADRAO_MS = 5 * 60_000;
/** Na analise de arquivos: sem nenhum byte por este tempo, o envio e interrompido. */
export const OCIOSIDADE_ENVIO_PADRAO_MS = 60_000;

/** `REQUISICAO_TEMPO_TOTAL_MS` sobrescreve (os testes usam segundos, nao minutos). */
export const tempoTotalMs = () => msDoAmbiente('REQUISICAO_TEMPO_TOTAL_MS', TEMPO_TOTAL_PADRAO_MS);
/** `ENVIO_OCIOSIDADE_MS` sobrescreve. */
export const ociosidadeEnvioMs = () => msDoAmbiente('ENVIO_OCIOSIDADE_MS', OCIOSIDADE_ENVIO_PADRAO_MS);

const temporizadores = new WeakMap<Request, NodeJS.Timeout>();

/**
 * Primeiro middleware do app: se o corpo nao chegar inteiro no tempo total, a conexao cai, como
 * fazia o `requestTimeout` do Node. Conta a partir daqui (cabecalhos ja lidos), entao o pior caso
 * e o `headersTimeout` (60 s) mais o total. Vale tambem depois da resposta: corpo que ninguem leu
 * (401, 404, 413) e descartado pelo Node e continua sujeito ao mesmo prazo.
 */
export function tempoTotalDaRequisicao(req: Request, res: Response, next: NextFunction) {
  if (!req.complete) {
    const temporizador = setTimeout(() => {
      if (!req.complete) req.socket.destroy();
    }, tempoTotalMs());
    temporizador.unref();
    temporizadores.set(req, temporizador);
    // Corpo inteiro = prazo cumprido. Sem corpo (GET), ninguem le a requisicao e o 'end' nao
    // vem: o fim da resposta solta o temporizador, para ele nao segurar a requisicao 5 min. Com
    // corpo ainda chegando, nem o fim da resposta nem o 'close' soltam: e o caso que o prazo
    // existe para cortar. Nada de ouvinte no socket, que e reaproveitado entre requisicoes
    // (keep-alive) e acumularia um ouvinte por requisicao.
    const parar = () => clearTimeout(temporizador);
    const pararSeCompleta = () => {
      if (req.complete) parar();
    };
    req.once('end', parar);
    req.once('close', pararSeCompleta);
    res.once('finish', pararSeCompleta);
  }
  next();
}

/**
 * Troca o tempo total desta requisicao por um tempo de OCIOSIDADE: o envio pode durar o quanto
 * precisar, desde que nao fique `ociosidadeEnvioMs()` sem mandar nenhum byte. So a analise de
 * arquivos chama isto, depois de autenticar e reservar a vaga: requisicao anonima ou recusada
 * continua no total. Termina sozinho quando o corpo acaba (a varredura do clamd, depois do
 * ultimo byte, tem o tempo limite proprio, CLAMAV_TIMEOUT_MS). `aoEsgotar` decide o que fazer.
 */
export function trocarPorOciosidade(req: Request, aoEsgotar: () => void): () => void {
  clearTimeout(temporizadores.get(req));
  temporizadores.delete(req);
  if (req.complete) return () => undefined;
  const temporizador = setTimeout(aoEsgotar, ociosidadeEnvioMs());
  temporizador.unref();
  const renovar = () => temporizador.refresh();
  const parar = () => {
    clearTimeout(temporizador);
    req.off('data', renovar);
  };
  // Ouvir 'data' tambem enquanto o corpo segue para o busboy: o fluxo ja esta correndo (pipe).
  req.on('data', renovar);
  req.once('end', parar);
  req.once('close', parar);
  return parar;
}
