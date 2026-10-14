// Monta zips em memoria para os testes do DT27 (sem dependencia e sem arquivo em disco): zip
// comum, Zip64 em cada uma das formas (campo extra no cabecalho local, no central, registro de
// fim Zip64 com localizador) e entradas guardadas ou comprimidas (deflate), para zip dentro de zip.
import { crc32, deflateRawSync } from 'node:zlib';

export interface EntradaDeTeste {
  nome: string;
  dados: Buffer;
  /** 'deflate' (padrao) ou 'guardado' (sem compressao). */
  metodo?: 'deflate' | 'guardado';
}

export interface OpcoesZipDeTeste {
  /** Campo extra Zip64 (0x0001) no cabecalho local, com os tamanhos em 0xFFFFFFFF (o do Python). */
  zip64Local?: boolean;
  /** Campo extra Zip64 no cabecalho central, com tamanhos e deslocamento em 0xFFFFFFFF. */
  zip64Central?: boolean;
  /** Registro de fim Zip64 + localizador antes do fim do diretorio central. */
  fim64?: boolean;
  /** Descritor de dados (bit 3): tamanhos e CRC depois dos dados, zerados no cabecalho local. */
  descritor?: boolean;
  /** Campo extra comum (id 0xCAFE, o do jar) no cabecalho local, antes do Zip64. */
  extraComum?: boolean;
}

const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

export function montarZip(entradas: EntradaDeTeste[], o: OpcoesZipDeTeste = {}): Buffer {
  const partes: Buffer[] = [];
  const centrais: Buffer[] = [];
  let pos = 0;
  const empurrar = (b: Buffer) => { partes.push(b); pos += b.length; };

  for (const e of entradas) {
    const deflate = (e.metodo ?? 'deflate') === 'deflate';
    const dados = deflate ? deflateRawSync(e.dados) : e.dados;
    const crc = crc32(e.dados);
    const nome = Buffer.from(e.nome, 'utf8');
    const flags = (o.descritor ? 0x0008 : 0) | 0x0800;
    const metodo = deflate ? 8 : 0;
    const versao = o.zip64Local || o.zip64Central || o.fim64 ? 45 : 20;
    const extras: Buffer[] = [];
    if (o.extraComum) extras.push(Buffer.concat([u16(0xcafe), u16(0)]));
    if (o.zip64Local) extras.push(Buffer.concat([u16(0x0001), u16(16), u64(e.dados.length), u64(dados.length)]));
    const extraLocal = Buffer.concat(extras);
    const inicio = pos;
    const tamanhosLocais = o.descritor
      ? [u32(0), u32(0), u32(0)]
      : o.zip64Local
        ? [u32(crc), u32(0xffffffff), u32(0xffffffff)]
        : [u32(crc), u32(dados.length), u32(e.dados.length)];
    empurrar(Buffer.concat([
      u32(0x04034b50), u16(versao), u16(flags), u16(metodo), u16(0), u16(0x21),
      ...tamanhosLocais, u16(nome.length), u16(extraLocal.length), nome, extraLocal,
    ]));
    empurrar(dados);
    if (o.descritor) empurrar(Buffer.concat([u32(0x08074b50), u32(crc), u32(dados.length), u32(e.dados.length)]));

    const extraCentral = o.zip64Central
      ? Buffer.concat([u16(0x0001), u16(24), u64(e.dados.length), u64(dados.length), u64(inicio)])
      : Buffer.alloc(0);
    const m = o.zip64Central ? 0xffffffff : -1;
    centrais.push(Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(versao), u16(flags), u16(metodo), u16(0), u16(0x21), u32(crc),
      u32(m >= 0 ? m : dados.length), u32(m >= 0 ? m : e.dados.length), u16(nome.length), u16(extraCentral.length), u16(0),
      u16(0), u16(0), u32(0), u32(m >= 0 ? m : inicio), nome, extraCentral,
    ]));
  }

  const inicioCentral = pos;
  const central = Buffer.concat(centrais);
  empurrar(central);
  if (o.fim64) {
    const inicioFim64 = pos;
    empurrar(Buffer.concat([
      u32(0x06064b50), u64(44), u16(0x031e), u16(45), u32(0), u32(0),
      u64(entradas.length), u64(entradas.length), u64(central.length), u64(inicioCentral),
    ]));
    empurrar(Buffer.concat([u32(0x07064b50), u32(0), u64(inicioFim64), u32(1)]));
  }
  empurrar(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(o.fim64 ? 0xffff : entradas.length), u16(o.fim64 ? 0xffff : entradas.length),
    u32(o.fim64 ? 0xffffffff : central.length), u32(o.fim64 ? 0xffffffff : inicioCentral), u16(0),
  ]));
  return Buffer.concat(partes);
}

/** Marcador de teste inofensivo (EICAR), montado em partes: o fonte nao contem a assinatura inteira. */
export const MARCADOR_TESTE = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''),
  'latin1',
);
