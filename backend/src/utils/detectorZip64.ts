import { createInflateRaw, type InflateRaw } from 'node:zlib';

// Detector de Zip64 em fluxo (DT27). O ClamAV 1.5.4 nao abre entradas de zip no formato Zip64
// (Cisco-Talos/clamav#1527): o marcador de teste que ele acha num zip comum passa como "OK"
// dentro de uma entrada Zip64, em zip, docx, xlsx, jar, apk, odt (todos usam o container zip).
// Este detector olha os bytes que passam a caminho do clamd, sem guardar o arquivo, e diz se ha
// estrutura Zip64 em algum lugar, inclusive dentro de zip comprimido dentro de zip.
//
// Falso positivo: a sequencia de 4 bytes de uma assinatura aparece por acaso em qualquer binario
// grande (uma vez a cada 4 GiB de bytes aleatorios). Por isso nenhuma assinatura sozinha basta;
// conta so a ESTRUTURA valida:
//   - localizador Zip64 (PK 06 07) seguido, colado, do fim do diretorio central (PK 05 06), ou
//     registro de fim Zip64 (PK 06 06) com tamanho coerente seguido, colado, do localizador;
//   - cabecalho local (PK 03 04) ou central (PK 01 02) inteiro e coerente (versao, metodo, nome e
//     campo extra que cabem, lista de campos extras bem formada) que traga o campo extra Zip64
//     (id 0x0001) ou 0xFFFFFFFF num campo de tamanho ou de deslocamento.
// Em dados aleatorios, cada um desses casos exige ao menos 8 bytes fixos em posicoes certas: a
// chance fica abaixo de 1 em 2^60 por posicao. O valor 0xFFFF no fim do diretorio central sozinho
// NAO conta: e o sinal mais fraco (2 bytes), e todo zip que o usa tem tambem o localizador.
//
// Zip dentro de zip: o zip interno guardado sem compressao aparece nos proprios bytes. O
// comprimido (deflate, o caso comum, e o de docx/xlsx/jar/apk) so aparece descomprimido: cada
// entrada deflate de um cabecalho local valido e descomprimida em fluxo (zlib do Node) e os bytes
// dela passam por um detector do nivel de baixo, recursivamente. Ha teto de bytes descomprimidos
// e de profundidade (zip-bomba); passou de um deles, a verificacao fica INCOMPLETA, o que nunca
// vira "sem Zip64" (quem chama trata como ameaca, por precaucao).

const PK = Buffer.from('PK', 'latin1');
const LOCAL = 0x0403; // PK 03 04: cabecalho local
const CENTRAL = 0x0201; // PK 01 02: cabecalho do diretorio central
const FIM = 0x0605; // PK 05 06: fim do diretorio central
const FIM64 = 0x0606; // PK 06 06: registro de fim Zip64
const LOCALIZADOR64 = 0x0706; // PK 06 07: localizador do fim Zip64
const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_LOCALIZADOR64 = 0x07064b50;
const ID_EXTRA_ZIP64 = 0x0001;
const MARCA32 = 0xffffffff;
const MARCA16 = 0xffff;
/** Metodos de compressao definidos na APPNOTE do PKWARE (o resto e lixo, nao cabecalho). */
const METODOS = new Set([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 14, 16, 18, 19, 93, 94, 95, 96, 97, 98, 99]);
const DEFLATE = 8;
/** Entrada pelo deflate em fatias pequenas: a saida de uma fatia fica na memoria ate ser lida. */
const FATIA_DESCOMPRESSAO = 16 * 1024;

export interface ResultadoZip64 {
  /** Achou estrutura Zip64 (no arquivo ou dentro de um compactado dentro dele). */
  zip64: boolean;
  /** A busca nao chegou ao fim (teto de descompressao ou de profundidade, ou falha interna). */
  incompleta: boolean;
}

export interface OpcoesDetectorZip64 {
  /** Total de bytes descomprimidos, somando todos os niveis. */
  limiteDescompressao: number;
  /** Niveis de compactado dentro de compactado que sao descomprimidos. */
  profundidadeMaxima: number;
}

interface Estado extends ResultadoZip64, OpcoesDetectorZip64 {
  descomprimidos: number;
}

/** Cabecalho local valido de uma entrada deflate: o comeco dos dados comprimidos. */
interface Candidato {
  posicao: number;
  inicioDados: number;
}

type Avaliacao = { tipo: 'zip64' } | { tipo: 'faltam_bytes' } | { tipo: 'nada' } | { tipo: 'entrada'; inicioDados: number; deflate: boolean };
const ZIP64: Avaliacao = { tipo: 'zip64' };
const FALTAM: Avaliacao = { tipo: 'faltam_bytes' };
const NADA: Avaliacao = { tipo: 'nada' };

/**
 * Campos extras (id de 2 bytes, tamanho de 2 bytes, dados) em `b[inicio, inicio + tamanho)`.
 * Devolve se a lista esta bem formada e se traz o campo Zip64. Bem formada: o primeiro campo
 * cabe (o resto pode ser preenchimento, como o do zipalign de APK) ou nao ha campo algum.
 */
function camposExtras(b: Buffer, inicio: number, tamanho: number): { valida: boolean; zip64: boolean } {
  const fim = inicio + tamanho;
  let p = inicio;
  let lidos = 0;
  while (p + 4 <= fim) {
    const id = b.readUInt16LE(p);
    const n = b.readUInt16LE(p + 2);
    if (p + 4 + n > fim) break;
    if (id === ID_EXTRA_ZIP64) return { valida: true, zip64: true };
    lidos++;
    p += 4 + n;
  }
  return { valida: tamanho === 0 || lidos > 0, zip64: false };
}

/** Versao "necessaria para extrair" plausivel (a APPNOTE vai ate 6.3; o byte alto e lixo de alguns geradores). */
const versaoValida = (v: number) => (v & 0xff) <= 63;

/** Avalia a assinatura PK em `b[i]`. `faltam_bytes`: a estrutura passa do fim do que ja chegou. */
function avaliar(b: Buffer, i: number): Avaliacao {
  if (i + 4 > b.length) return FALTAM;
  const tipo = b.readUInt16LE(i + 2);
  const resta = b.length - i;
  switch (tipo) {
    case LOCAL: {
      if (resta < 30) return FALTAM;
      const versao = b.readUInt16LE(i + 4);
      const flags = b.readUInt16LE(i + 6);
      const metodo = b.readUInt16LE(i + 8);
      if (!versaoValida(versao) || !METODOS.has(metodo)) return NADA;
      const nome = b.readUInt16LE(i + 26);
      const extra = b.readUInt16LE(i + 28);
      if (resta < 30 + nome + extra) return FALTAM;
      const extras = camposExtras(b, i + 30 + nome, extra);
      if (!extras.valida) return NADA;
      if (extras.zip64 || b.readUInt32LE(i + 18) === MARCA32 || b.readUInt32LE(i + 22) === MARCA32) return ZIP64;
      // Bit 0: entrada cifrada (os dados nao sao deflate legivel).
      return { tipo: 'entrada', inicioDados: i + 30 + nome + extra, deflate: metodo === DEFLATE && (flags & 1) === 0 };
    }
    case CENTRAL: {
      if (resta < 46) return FALTAM;
      if (!versaoValida(b.readUInt16LE(i + 6)) || !METODOS.has(b.readUInt16LE(i + 10))) return NADA;
      const nome = b.readUInt16LE(i + 28);
      const extra = b.readUInt16LE(i + 30);
      if (resta < 46 + nome + extra) return FALTAM;
      const extras = camposExtras(b, i + 46 + nome, extra);
      if (!extras.valida) return NADA;
      const marcado =
        b.readUInt32LE(i + 20) === MARCA32 || b.readUInt32LE(i + 24) === MARCA32 ||
        b.readUInt32LE(i + 42) === MARCA32 || b.readUInt16LE(i + 34) === MARCA16;
      return extras.zip64 || marcado ? ZIP64 : NADA;
    }
    case LOCALIZADOR64: {
      // Localizador (20 bytes) e, colado nele, o fim do diretorio central.
      if (resta < 24) return FALTAM;
      return b.readUInt32LE(i + 20) === ASSINATURA_FIM ? ZIP64 : NADA;
    }
    case FIM64: {
      // Registro de fim Zip64: tamanho (8 bytes) de no minimo 44, e o localizador logo depois.
      if (resta < 12) return FALTAM;
      if (b.readUInt32LE(i + 8) !== 0) return NADA;
      const tamanho = b.readUInt32LE(i + 4);
      if (tamanho < 44 || tamanho > MARCA16) return NADA;
      if (resta < 12 + tamanho + 4) return FALTAM;
      return b.readUInt32LE(i + 12 + tamanho) === ASSINATURA_LOCALIZADOR64 ? ZIP64 : NADA;
    }
    default:
      return NADA;
  }
}

/** Descompressao em fluxo de uma entrada deflate, com a saida indo ao detector do nivel de baixo. */
class Descompressao {
  private readonly zlib: InflateRaw = createInflateRaw();
  private saidas: Buffer[] = [];
  private terminou = false;
  private falhou = false;
  /** Posicao absoluta (no nivel de cima) ate onde os dados comprimidos ja entraram. */
  private alimentadoAte: number;

  constructor(
    readonly candidato: Candidato,
    private readonly filho: Nivel,
    private readonly estado: Estado,
  ) {
    this.alimentadoAte = candidato.inicioDados;
    this.zlib.on('data', (d: Buffer) => this.saidas.push(d));
    this.zlib.on('end', () => { this.terminou = true; });
    this.zlib.on('error', () => { this.falhou = true; });
  }

  /** Onde a entrada acaba (posicao absoluta), depois de `terminou`. */
  get fim(): number {
    return this.candidato.inicioDados + this.zlib.bytesWritten;
  }

  /**
   * Da ao deflate os bytes de `b` (que comeca na posicao absoluta `inicioB`) ainda nao dados.
   * `continua`: tudo entrou e a entrada segue no proximo bloco; `fim`: a entrada acabou (em
   * `fim`); `erro`: nao era deflate valido (cabecalho por acaso ou entrada corrompida); `parar`:
   * achou Zip64 ou estourou um teto.
   */
  async alimentar(b: Buffer, inicioB: number): Promise<'continua' | 'fim' | 'erro' | 'parar'> {
    for (let p = this.alimentadoAte - inicioB; p < b.length; p += FATIA_DESCOMPRESSAO) {
      const fatia = b.subarray(p, Math.min(p + FATIA_DESCOMPRESSAO, b.length));
      await this.aguardar((pronto) => this.zlib.write(fatia, pronto));
      // O 'end' do zlib sai num process.nextTick depois do fim do deflate.
      if (!this.terminou && !this.falhou) await new Promise((ok) => setImmediate(ok));
      if (await this.repassar()) return 'parar';
      if (this.terminou) return 'fim';
      if (this.falhou) return 'erro';
      this.alimentadoAte = inicioB + p + fatia.length;
    }
    return 'continua';
  }

  /** Repassa o que saiu do deflate ao nivel de baixo; true se e hora de parar tudo. */
  private async repassar(): Promise<boolean> {
    while (this.saidas.length) {
      const saida = this.saidas.shift()!;
      this.estado.descomprimidos += saida.length;
      if (this.estado.descomprimidos > this.estado.limiteDescompressao) {
        this.estado.incompleta = true;
        this.saidas = [];
        return true;
      }
      await this.filho.observar(saida);
      if (this.estado.zip64) return true;
    }
    return this.estado.incompleta;
  }

  /** Fecha a entrada: o que faltar sair do deflate (fim do arquivo no meio dela) vai ao filho. */
  async encerrar(): Promise<void> {
    if (!this.terminou && !this.falhou && !this.estado.zip64 && !this.estado.incompleta) {
      await this.aguardar((pronto) => {
        this.zlib.once('end', pronto);
        this.zlib.end();
      });
      if (!(await this.repassar())) await this.filho.finalizar();
    } else if (this.terminou && !this.estado.zip64 && !this.estado.incompleta) {
      await this.filho.finalizar();
    }
    this.descartar();
  }

  descartar(): void {
    this.saidas = [];
    this.zlib.destroy();
    this.filho.descartar();
  }

  /**
   * Espera uma operacao do zlib terminar ou o zlib falhar/fechar. Com deflate invalido o zlib
   * se destroi e o callback da escrita em curso pode nunca ser chamado: esperar so por ele
   * prendia a analise.
   */
  private aguardar(operacao: (pronto: () => void) => void): Promise<void> {
    return new Promise<void>((ok) => {
      if (this.zlib.destroyed) return ok();
      const pronto = () => {
        this.zlib.off('error', pronto);
        this.zlib.off('close', pronto);
        ok();
      };
      this.zlib.once('error', pronto);
      this.zlib.once('close', pronto);
      operacao(pronto);
    });
  }
}

/** Um nivel: o arquivo enviado (0) ou o conteudo descomprimido de uma entrada dele (1, 2...). */
class Nivel {
  /** Bytes do fim do bloco anterior que ainda serao avaliados (uma estrutura cortada no meio). */
  private resto = Buffer.alloc(0);
  /** Posicao absoluta do primeiro byte de `resto` e, sem resto, do proximo bloco. */
  private inicioResto = 0;
  /** Proxima posicao absoluta ainda nao avaliada. */
  private avaliarDe = 0;
  /** Entradas deflate so comecam depois do fim da anterior (o que esta dentro dela e dado comprimido). */
  private proximaEntrada = 0;
  private ativa: Descompressao | null = null;

  constructor(
    private readonly estado: Estado,
    private readonly profundidade: number,
  ) {}

  async observar(bloco: Buffer): Promise<void> {
    if (this.estado.zip64 || bloco.length === 0) return;
    const b = this.resto.length ? Buffer.concat([this.resto, bloco]) : bloco;
    const inicioB = this.inicioResto;
    const candidatos = this.varrer(b, inicioB, false);
    if (this.estado.zip64) return;
    await this.descomprimir(b, inicioB, candidatos);
    // Guarda so o que ainda vai ser avaliado (copia: nao prende o bloco inteiro na memoria).
    this.resto = Buffer.from(b.subarray(this.avaliarDe - inicioB));
    this.inicioResto = this.avaliarDe;
  }

  async finalizar(): Promise<void> {
    if (this.estado.zip64) return this.descartar();
    const candidatos = this.varrer(this.resto, this.inicioResto, true);
    if (!this.estado.zip64) await this.descomprimir(this.resto, this.inicioResto, candidatos);
    if (this.ativa) {
      const ativa = this.ativa;
      this.ativa = null;
      await ativa.encerrar();
    }
    this.resto = Buffer.alloc(0);
  }

  descartar(): void {
    this.ativa?.descartar();
    this.ativa = null;
    this.resto = Buffer.alloc(0);
  }

  /**
   * Avalia cada "PK" de `b` a partir de `avaliarDe`. Estrutura que passa do fim de `b` fica para o
   * proximo bloco (a avaliacao para nela e o resto e guardado), a nao ser no fim do arquivo
   * (`final`), quando o que nao cabe e so lixo. Devolve os cabecalhos locais de entradas deflate.
   */
  private varrer(b: Buffer, inicioB: number, final: boolean): Candidato[] {
    const candidatos: Candidato[] = [];
    let i = this.avaliarDe - inicioB;
    for (;;) {
      const j = b.indexOf(PK, i);
      if (j < 0) {
        // Um "P" no ultimo byte pode ser o comeco de uma assinatura cortada; sem ele, nada fica
        // para tras (e o proximo bloco e usado sem copia).
        const fim = b.length > 0 && b[b.length - 1] === PK[0] ? b.length - 1 : b.length;
        this.avaliarDe = inicioB + Math.max(i, fim);
        return candidatos;
      }
      const r = avaliar(b, j);
      if (r.tipo === 'faltam_bytes' && !final) {
        this.avaliarDe = inicioB + j;
        return candidatos;
      }
      if (r.tipo === 'zip64') {
        this.estado.zip64 = true;
        return [];
      }
      if (r.tipo === 'entrada' && r.deflate) candidatos.push({ posicao: inicioB + j, inicioDados: inicioB + r.inicioDados });
      i = j + 1;
    }
  }

  /** Leva os dados de `b` a entrada deflate em curso e abre as seguintes, uma de cada vez. */
  private async descomprimir(b: Buffer, inicioB: number, candidatos: Candidato[]): Promise<void> {
    let k = 0;
    for (;;) {
      if (this.estado.zip64) return this.descartar();
      if (this.ativa) {
        if (this.estado.incompleta) return this.descartar();
        const ativa = this.ativa;
        const desfecho = await ativa.alimentar(b, inicioB);
        if (desfecho === 'continua') return;
        this.ativa = null;
        if (desfecho === 'parar') return ativa.descartar();
        // Cabecalho por acaso (deflate invalido): as entradas seguintes podem estar logo depois dele.
        this.proximaEntrada = desfecho === 'fim' ? ativa.fim : ativa.candidato.posicao + 1;
        await ativa.encerrar();
        if (this.estado.zip64 || this.estado.incompleta) return;
      }
      while (k < candidatos.length && candidatos[k].posicao < this.proximaEntrada) k++;
      if (k >= candidatos.length || this.estado.incompleta) return;
      if (this.profundidade >= this.estado.profundidadeMaxima) {
        this.estado.incompleta = true;
        return;
      }
      this.ativa = new Descompressao(candidatos[k++], new Nivel(this.estado, this.profundidade + 1), this.estado);
    }
  }
}

/**
 * Detector de Zip64 para um arquivo que chega em blocos: `observar` cada bloco, na ordem, e
 * `finalizar` no fim. Nunca lanca: falha interna vira `incompleta` (nunca "sem Zip64").
 */
export class DetectorZip64 {
  private readonly estado: Estado;
  private readonly raiz: Nivel;
  private encerrado = false;

  constructor(opcoes: OpcoesDetectorZip64) {
    this.estado = { zip64: false, incompleta: false, descomprimidos: 0, ...opcoes };
    this.raiz = new Nivel(this.estado, 0);
  }

  async observar(bloco: Buffer): Promise<void> {
    if (this.encerrado) return;
    try {
      await this.raiz.observar(bloco);
    } catch (e) {
      this.falha(e);
    }
  }

  async finalizar(): Promise<ResultadoZip64> {
    if (!this.encerrado) {
      this.encerrado = true;
      try {
        await this.raiz.finalizar();
      } catch (e) {
        this.falha(e);
      }
      this.raiz.descartar();
    }
    return { zip64: this.estado.zip64, incompleta: !this.estado.zip64 && this.estado.incompleta };
  }

  /** Abandona a busca (analise interrompida): solta os descompressores. */
  descartar(): void {
    this.encerrado = true;
    this.raiz.descartar();
  }

  private falha(e: unknown) {
    console.error('[zip64] falha na verificação (tratada como incompleta):', e instanceof Error ? e.message : e);
    this.estado.incompleta = true;
    this.raiz.descartar();
  }
}
