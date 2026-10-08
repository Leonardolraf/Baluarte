import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AntivirusIndisponivel, analisar as analisarNoAntivirus, antivirusConfigurado } from '../config/antivirus.js';
import type { UsuarioAtual } from '../models/usuario.model.js';
import { OPERADORES } from '../models/dominio.model.js';
import {
  LIMITE_ANALISES_POR_HORA, LIMITE_ARQUIVO_BYTES, MENSAGEM_LIMPO, mensagemAmeaca, nomeParaExibir, type AnaliseDto,
} from '../models/analiseArquivo.model.js';
import { segundaOpiniaoDto } from '../models/segundaOpiniao.model.js';
import * as repo from '../repositories/analiseArquivo.repository.js';
import { falhar } from '../utils/resposta.js';
import { registrarAuditoria } from './auditoria.service.js';
import * as segundaOpiniao from './segundaOpiniao.service.js';

// Analise de arquivo (B04): o arquivo passa em fluxo pelo ClamAV, com o SHA-256 e o tamanho
// calculados no caminho, e e descartado. Nada vai para disco nem volta para o navegador.
// Depois do ClamAV vem a segunda opiniao do VirusTotal (B20), so pelo SHA-256: o arquivo nunca
// e enviado, a falha dela nunca derruba a analise e ela nao muda o veredito principal.

const UMA_HORA_MS = 60 * 60 * 1000;
const MSG_INDISPONIVEL = 'A análise de arquivos não está disponível neste ambiente';

/** Antes de receber o corpo: antivirus no ar e limite por hora (barato, sem ler o arquivo). */
export async function verificarAntesDeReceber(userId: string): Promise<void> {
  if (!antivirusConfigurado()) falhar(503, MSG_INDISPONIVEL, 'ANTIVIRUS_INDISPONIVEL');
  if ((await repo.contarDesde(userId, new Date(Date.now() - UMA_HORA_MS))) >= LIMITE_ANALISES_POR_HORA)
    falhar(429, 'Limite de análises por hora atingido. Tente novamente mais tarde.', 'MUITAS_ANALISES');
}

/** Fluxo do arquivo como recebido do multipart (busboy marca `truncated` ao passar do limite). */
export type FluxoArquivo = Readable & { truncated?: boolean };

/**
 * Repassa os blocos ao antivirus calculando o SHA-256 e o tamanho. Passou do limite: interrompe
 * o envio com 413 (o veredito de um arquivo cortado nao vale).
 */
async function* medir(fluxo: FluxoArquivo, medida: { bytes: number; hash: ReturnType<typeof createHash> }) {
  for await (const bloco of fluxo as AsyncIterable<Buffer>) {
    medida.bytes += bloco.length;
    if (medida.bytes > LIMITE_ARQUIVO_BYTES) break;
    medida.hash.update(bloco);
    yield bloco;
  }
  if (fluxo.truncated || medida.bytes > LIMITE_ARQUIVO_BYTES)
    falhar(413, 'Arquivo maior que o limite de 10 MB', 'ARQUIVO_MUITO_GRANDE');
}

/** Analisa, registra e audita. Devolve a mensagem e o registro no formato da API. */
export async function analisar(usuario: UsuarioAtual, nomeOriginal: string | undefined, fluxo: FluxoArquivo) {
  const medida = { bytes: 0, hash: createHash('sha256') };
  let veredito;
  try {
    veredito = await analisarNoAntivirus(medir(fluxo, medida));
  } catch (e) {
    if (e instanceof AntivirusIndisponivel) {
      console.error('[antivirus] indisponível:', e.message);
      falhar(503, MSG_INDISPONIVEL, 'ANTIVIRUS_INDISPONIVEL');
    }
    throw e;
  }
  const sha256 = medida.hash.digest('hex');
  const registro = await repo.criar({
    userId: usuario.id,
    nome: nomeParaExibir(nomeOriginal),
    tamanho: medida.bytes,
    sha256,
    resultado: veredito.resultado,
    ameaca: veredito.ameaca,
    ...(await segundaOpiniao.obter(sha256)),
  });
  await registrarAuditoria(usuario.id, 'ANALISAR_ARQUIVO', `${registro.nome} (${registro.sha256}): ${registro.resultado}${registro.ameaca ? ` ${registro.ameaca}` : ''}; VirusTotal: ${registro.vtSituacao}`);
  return {
    mensagem: registro.ameaca ? mensagemAmeaca(registro.ameaca) : MENSAGEM_LIMPO,
    dados: paraDto(registro),
  };
}

function paraDto(r: Awaited<ReturnType<typeof repo.criar>>, usuario?: { nome: string; email: string }): AnaliseDto {
  return {
    id: r.id,
    nome: r.nome,
    tamanho: r.tamanho,
    sha256: r.sha256,
    resultado: r.resultado as AnaliseDto['resultado'],
    ameaca: r.ameaca,
    analisadoEm: r.criadoEm,
    segundaOpiniao: segundaOpiniaoDto(r),
    ...(usuario ? { usuario } : {}),
  };
}

/** Historico: o Colaborador ve so as proprias analises; operadores veem todas, com quem enviou. */
export async function listar(usuario: UsuarioAtual): Promise<AnaliseDto[]> {
  const operador = OPERADORES.includes(usuario.perfil);
  const registros = await repo.listar(operador ? undefined : usuario.id);
  return registros.map((r) => paraDto(r, operador ? { nome: r.user.nome, email: r.user.email } : undefined));
}
