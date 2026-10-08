import { connect, type Socket } from 'node:net';

// Cliente do clamd (ClamAV) pelo protocolo INSTREAM: o arquivo vai em blocos pela rede, com
// cada bloco precedido do tamanho (4 bytes, big-endian) e um bloco de tamanho zero no fim. Nada
// e gravado em disco, nem aqui nem no clamd. Resposta: "stream: OK", "stream: <ameaca> FOUND"
// ou "... ERROR". Endereco em CLAMAV_HOST/CLAMAV_PORT (servico clamav do Compose, perfil
// `antivirus`).

export type Veredito = { resultado: 'LIMPO' | 'AMEACA'; ameaca: string | null };

/** O clamd nao respondeu (fora do ar, sem rede, tempo esgotado ou erro dele). */
export class AntivirusIndisponivel extends Error {}

const TEMPO_LIMITE_MS = Number(process.env.CLAMAV_TIMEOUT_MS ?? 60_000);

export function antivirusConfigurado(): boolean {
  return Boolean(process.env.CLAMAV_HOST);
}

function escrever(socket: Socket, dados: Buffer): Promise<void> {
  return new Promise((ok, falha) => {
    if (socket.write(dados)) return ok();
    socket.once('drain', ok);
    socket.once('error', (e) => falha(new AntivirusIndisponivel(e.message)));
  });
}

/** Le a resposta do clamd (termina em \0 no modo "z"). */
export function lerVeredito(resposta: string): Veredito {
  const texto = resposta.replace(/\0/g, '').trim();
  if (/^stream: OK$/.test(texto)) return { resultado: 'LIMPO', ameaca: null };
  const achado = texto.match(/^stream: (.+) FOUND$/);
  if (achado) return { resultado: 'AMEACA', ameaca: achado[1] };
  throw new AntivirusIndisponivel(`resposta inesperada do clamd: ${texto.slice(0, 120)}`);
}

/**
 * Envia o conteudo ao clamd em fluxo e devolve o veredito. Lanca AntivirusIndisponivel se
 * o clamd nao responder; nunca devolve "limpo" por falha. Erro lancado pela fonte dos blocos
 * interrompe o envio e sobe sem alteracao.
 */
export async function analisar(blocos: AsyncIterable<Buffer>): Promise<Veredito> {
  if (!antivirusConfigurado()) throw new AntivirusIndisponivel('CLAMAV_HOST não configurado');
  const socket = connect({ host: process.env.CLAMAV_HOST, port: Number(process.env.CLAMAV_PORT ?? 3310) });
  socket.setTimeout(TEMPO_LIMITE_MS);

  const resposta = new Promise<string>((ok, falha) => {
    let texto = '';
    socket.on('data', (d) => { texto += d.toString('utf8'); });
    socket.on('end', () => ok(texto));
    socket.on('timeout', () => { socket.destroy(); falha(new AntivirusIndisponivel('tempo esgotado no clamd')); });
    socket.on('error', (e) => falha(new AntivirusIndisponivel(e.message)));
  });

  try {
    await new Promise<void>((ok, falha) => {
      socket.once('connect', ok);
      socket.once('error', (e) => falha(new AntivirusIndisponivel(e.message)));
    });
    await escrever(socket, Buffer.from('zINSTREAM\0'));
    for await (const bloco of blocos) {
      if (bloco.length === 0) continue;
      const tamanho = Buffer.alloc(4);
      tamanho.writeUInt32BE(bloco.length);
      await escrever(socket, Buffer.concat([tamanho, bloco]));
    }
    await escrever(socket, Buffer.alloc(4)); // bloco de tamanho zero: fim do arquivo
    socket.end();
    return lerVeredito(await resposta);
  } catch (e) {
    socket.destroy();
    // Evita rejeicao nao tratada da promessa de resposta quando a falha veio antes dela.
    resposta.catch(() => undefined);
    // Falha de rede/clamd ja chega como AntivirusIndisponivel; o resto veio da FONTE dos blocos
    // (ex.: arquivo maior que o limite) e sobe como esta, para quem chamou decidir a resposta.
    throw e;
  }
}
