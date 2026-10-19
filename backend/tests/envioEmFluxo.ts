// Apoio aos testes do limite de tamanho da analise de arquivos (250 MB). Nada aqui guarda o
// arquivo inteiro na memoria: o corpo multipart e gerado em blocos reaproveitados e o clamd
// falso le o protocolo INSTREAM em fluxo, contando os bytes e guardando so o comeco do arquivo
// (o suficiente para reconhecer os marcadores dos testes). Alocar 250 MB de uma vez por teste,
// como o Buffer.alloc do limite antigo de 10 MB, e o que este arquivo existe para evitar.
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Socket } from 'node:net';
import { urlBase } from './helpers.js';

/** Bytes guardados do comeco de cada arquivo recebido pelo clamd falso. */
const AMOSTRA_PADRAO = 1024 * 1024;

/**
 * Le um pedido INSTREAM em fluxo ("zINSTREAM\0" + [tamanho 4 bytes][dados]... + 4 bytes zero) e
 * chama `aoFim` com o comeco do conteudo (ate `limiteAmostra` bytes) e o total recebido. Custo
 * constante por bloco: nada de concatenar tudo o que ja chegou a cada evento `data`.
 */
export function lerInstream(socket: Socket, aoFim: (amostra: Buffer, total: number) => void, limiteAmostra = AMOSTRA_PADRAO) {
  const comando = Buffer.from('zINSTREAM\0');
  let pendente = Buffer.alloc(0); // so o que sobrou incompleto do evento anterior (comando ou cabecalho)
  let comandoLido = false;
  let faltaNoBloco = 0;
  let total = 0;
  const amostra: Buffer[] = [];
  let tamanhoAmostra = 0;
  let terminou = false;
  socket.on('data', (d: Buffer) => {
    if (terminou) return;
    const buf = pendente.length ? Buffer.concat([pendente, d]) : d;
    pendente = Buffer.alloc(0);
    let pos = 0;
    if (!comandoLido) {
      if (buf.length < comando.length) {
        pendente = Buffer.from(buf);
        return;
      }
      pos = comando.length;
      comandoLido = true;
    }
    while (pos < buf.length) {
      if (faltaNoBloco > 0) {
        const n = Math.min(faltaNoBloco, buf.length - pos);
        if (tamanhoAmostra < limiteAmostra) {
          const parte = buf.subarray(pos, pos + Math.min(n, limiteAmostra - tamanhoAmostra));
          amostra.push(Buffer.from(parte));
          tamanhoAmostra += parte.length;
        }
        total += n;
        faltaNoBloco -= n;
        pos += n;
        continue;
      }
      if (buf.length - pos < 4) {
        pendente = Buffer.from(buf.subarray(pos));
        return;
      }
      const n = buf.readUInt32BE(pos);
      pos += 4;
      if (n === 0) {
        terminou = true;
        aoFim(Buffer.concat(amostra), total);
        return;
      }
      faltaNoBloco = n;
    }
  });
}

/**
 * Envia `tamanho` bytes iguais a `byte` como o campo `arquivo` de um multipart/form-data, com
 * Content-Length (como o navegador), gerados em blocos de 1 MB reaproveitados. Com `cauda`, os
 * ultimos `cauda.length` bytes do arquivo sao ela (o total continua `tamanho`): e assim que o
 * teste de aceitacao poe o marcador no fim do arquivo sem montar o arquivo inteiro. Devolve o
 * status e o corpo JSON da resposta.
 */
export function enviarArquivoEmFluxo(opcoes: {
  token: string;
  tamanho: number;
  query?: string;
  nome?: string;
  byte?: number;
  cauda?: Buffer;
}): Promise<{ status: number; body: any }> {
  const { token, tamanho, query = '', nome = 'grande.bin', byte = 65, cauda = Buffer.alloc(0) } = opcoes;
  if (cauda.length > tamanho) throw new Error('a cauda é maior que o arquivo');
  const fronteira = `----baluarte${randomBytes(12).toString('hex')}`;
  const inicio = Buffer.from(
    `--${fronteira}\r\nContent-Disposition: form-data; name="arquivo"; filename="${nome}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
  );
  const fim = Buffer.from(`\r\n--${fronteira}--\r\n`);
  const bloco = Buffer.alloc(1024 * 1024, byte);

  function* corpo() {
    yield inicio;
    let falta = tamanho - cauda.length;
    while (falta > 0) {
      const n = Math.min(falta, bloco.length);
      yield n === bloco.length ? bloco : bloco.subarray(0, n);
      falta -= n;
    }
    if (cauda.length) yield cauda;
    yield fim;
  }

  return new Promise((ok, falha) => {
    const req = request(
      `${urlBase()}/arquivos/analise${query}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${fronteira}`,
          'Content-Length': inicio.length + tamanho + fim.length,
        },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { texto += c; });
        res.on('end', () => {
          try {
            ok({ status: res.statusCode ?? 0, body: JSON.parse(texto) });
          } catch {
            falha(new Error(`resposta sem JSON (${res.statusCode}): ${texto.slice(0, 200)}`));
          }
        });
      },
    );
    // Erro de escrita depois de a resposta chegar (o servidor ja respondeu o 413) nao importa.
    req.on('error', falha);
    Readable.from(corpo(), { objectMode: false }).pipe(req);
  });
}
