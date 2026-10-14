import { connect, type Socket } from 'node:net';
import { msDoAmbiente } from '../utils/ambiente.js';

// Cliente do clamd (ClamAV) pelo protocolo INSTREAM: o arquivo vai em blocos pela rede, com
// cada bloco precedido do tamanho (4 bytes, big-endian) e um bloco de tamanho zero no fim. Aqui
// nada e gravado em disco nem guardado inteiro na memoria: cada bloco segue assim que chega. O
// clamd, do lado dele, junta o fluxo num arquivo temporario no /tmp do conteiner (medido em
// 13/10/2026: 250 MB viram um .tmp de 250 MB, mais a copia normalizada se for HTML) e o apaga
// ao fim da varredura. Resposta: "stream: OK", "stream: <ameaca> FOUND" ou "... ERROR".
// Endereco em CLAMAV_HOST/CLAMAV_PORT (servico clamav do Compose, perfil `antivirus`).

export type Veredito = { resultado: 'LIMPO' | 'AMEACA'; ameaca: string | null };

/** O clamd nao respondeu (fora do ar, sem rede, tempo esgotado ou erro dele). */
export class AntivirusIndisponivel extends Error {}

/**
 * Tempo maximo SEM TROCA DE DADOS com o clamd (inatividade do socket, nao a duracao total).
 * Enquanto o arquivo chega, os blocos fluem; o silencio longo e depois do ultimo bloco, quando
 * o clamd varre. Com 250 MB essa varredura levou de 6 s a 65 s num desktop de 16 nucleos
 * (13/10/2026; o tempo cresce com as regras de expressao regular e a normalizacao de HTML), e
 * numa VM menor leva mais: 5 min de folga. Valor vazio, zero ou invalido no ambiente volta ao
 * padrao (zero desligaria o tempo limite do socket).
 */
export const TEMPO_LIMITE_PADRAO_MS = 300_000;
export function tempoLimiteMs(): number {
  return msDoAmbiente('CLAMAV_TIMEOUT_MS', TEMPO_LIMITE_PADRAO_MS);
}

export function antivirusConfigurado(): boolean {
  return Boolean(process.env.CLAMAV_HOST);
}

/**
 * Escreve um bloco respeitando a contrapressao do socket. Os ouvintes de `drain` e `error` saem
 * juntos assim que um dos dois acontece: sem isso, cada bloco que esperava o `drain` deixava um
 * ouvinte de `error` pendurado e um arquivo grande passava do limite de 10 ouvintes do Node
 * (MaxListenersExceededWarning).
 */
export function escrever(socket: Socket, dados: Buffer): Promise<void> {
  return new Promise((ok, falha) => {
    // DT26: o clamd que fecha no meio do envio (respondendo ou nao) deixa o socket encerrado. Ali
    // o `write` so falha no callback, sem 'error' nem 'drain', e esperar por eles prendia a
    // analise para sempre (o socket destruido nem dispara mais o tempo limite).
    const encerrado = () => new AntivirusIndisponivel('o clamd encerrou a conexão antes do fim do envio');
    if (socket.destroyed || socket.writableEnded) return falha(encerrado());
    if (socket.write(dados)) return ok();
    const soltar = () => {
      socket.off('drain', aoDrenar);
      socket.off('error', aoFalhar);
      socket.off('close', aoFechar);
    };
    const aoDrenar = () => {
      soltar();
      ok();
    };
    const aoFalhar = (e: Error) => {
      soltar();
      falha(new AntivirusIndisponivel(e.message));
    };
    const aoFechar = () => {
      soltar();
      falha(encerrado());
    };
    socket.once('drain', aoDrenar);
    socket.once('error', aoFalhar);
    socket.once('close', aoFechar);
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
 *
 * DT26 ("limpo em tempo impossivel"): o veredito so vale se chegar DEPOIS do bloco de tamanho
 * zero, ou seja, depois de o clamd ter recebido o arquivo inteiro. Resposta que chega antes do
 * fim do envio (um clamd com defeito, um proxy no caminho, outro servico na porta) falaria de um
 * arquivo pela metade: vira AntivirusIndisponivel, nunca "limpo". O clamd de verdade so responde
 * antes do fim para recusar ("INSTREAM size limit exceeded. ERROR"), que ja era falha. Um limite
 * de tempo minimo por tamanho nao entra: varrer 250 MB levou de 6 s a 65 s conforme as regras, e
 * arquivo pequeno sai em milissegundos, entao qualquer piso seria arbitrario; o que garante que
 * o arquivo inteiro foi visto e a ordem do protocolo, e e ela que se confere.
 */
export async function analisar(blocos: AsyncIterable<Buffer>): Promise<Veredito> {
  if (!antivirusConfigurado()) throw new AntivirusIndisponivel('CLAMAV_HOST não configurado');
  const socket = connect({ host: process.env.CLAMAV_HOST, port: Number(process.env.CLAMAV_PORT ?? 3310) });
  socket.setTimeout(tempoLimiteMs());

  let envioCompleto = false;
  let respostaAntesDoFim = false;
  const resposta = new Promise<string>((ok, falha) => {
    let texto = '';
    socket.on('data', (d) => {
      if (!envioCompleto) respostaAntesDoFim = true;
      texto += d.toString('utf8');
    });
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
    envioCompleto = true;
    socket.end();
    const texto = await resposta;
    if (respostaAntesDoFim) {
      throw new AntivirusIndisponivel(`o clamd respondeu antes do fim do envio: ${texto.replace(/\0/g, '').trim().slice(0, 120)}`);
    }
    return lerVeredito(texto);
  } catch (e) {
    socket.destroy();
    // Evita rejeicao nao tratada da promessa de resposta quando a falha veio antes dela.
    resposta.catch(() => undefined);
    // Falha de rede/clamd ja chega como AntivirusIndisponivel; o resto veio da FONTE dos blocos
    // (ex.: arquivo maior que o limite) e sobe como esta, para quem chamou decidir a resposta.
    throw e;
  }
}
