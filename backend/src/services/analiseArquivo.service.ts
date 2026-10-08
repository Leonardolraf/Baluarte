import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AntivirusIndisponivel, analisar as analisarNoAntivirus, antivirusConfigurado } from '../config/antivirus.js';
import type { UsuarioAtual } from '../models/usuario.model.js';
import { OPERADORES } from '../models/dominio.model.js';
import {
  JANELA_ARQUIVOS_MALICIOSOS_DIAS, LIMITE_ANALISES_POR_HORA, LIMITE_ANEXOS_POR_CAMPANHA, LIMITE_ARQUIVO_BYTES,
  ehRegraPropria, mensagemDoResultado, nomeParaExibir, type AnaliseDto, type AnexoCampanhaDto, type CampanhaDeOrigem,
  type CampanhaRecebidaDto, type FiltrosHistorico, type ResultadoAnalise,
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

/** Evento de campanha ja conferido (do proprio usuario, com e-mail enviado), origem do anexo. */
export interface OrigemCampanha {
  eventoId: string;
  campanha: CampanhaDeOrigem;
}

/**
 * Antes de receber o corpo (barato, sem ler o arquivo): antivirus no ar, limite por hora e, no
 * anexo de campanha (B23), a origem. A campanha tem de ser do proprio usuario e ja ter sido
 * enviada a ele; evento inexistente e evento de outra pessoa dao o mesmo 404, para a rota nao
 * servir de oraculo de ids. Devolve a origem conferida (ou null no envio avulso).
 */
export async function verificarAntesDeReceber(userId: string, eventoCampanha?: string): Promise<OrigemCampanha | null> {
  if (!antivirusConfigurado()) falhar(503, MSG_INDISPONIVEL, 'ANTIVIRUS_INDISPONIVEL');
  if ((await repo.contarDesde(userId, new Date(Date.now() - UMA_HORA_MS))) >= LIMITE_ANALISES_POR_HORA)
    falhar(429, 'Limite de análises por hora atingido. Tente novamente mais tarde.', 'MUITAS_ANALISES');
  if (!eventoCampanha) return null;
  const evento = await repo.eventoDoUsuario(eventoCampanha, userId);
  if (!evento?.enviadoEm) falhar(404, 'Campanha não encontrada entre as que você recebeu', 'CAMPANHA_NAO_RECEBIDA');
  if ((await repo.contarAnexosDoEvento(evento.id)) >= LIMITE_ANEXOS_POR_CAMPANHA)
    falhar(429, `Limite de ${LIMITE_ANEXOS_POR_CAMPANHA} anexos por campanha atingido`, 'LIMITE_ANEXOS_CAMPANHA');
  return { eventoId: evento.id, campanha: evento.campaign };
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
export async function analisar(usuario: UsuarioAtual, nomeOriginal: string | undefined, fluxo: FluxoArquivo, origem: OrigemCampanha | null = null) {
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
    campaignEventId: origem?.eventoId ?? null,
    ...(await segundaOpiniao.obter(sha256)),
  });
  const deCampanha = origem ? `; anexo da campanha ${origem.campanha.nome} (${origem.campanha.id})` : '';
  await registrarAuditoria(usuario.id, 'ANALISAR_ARQUIVO', `${registro.nome} (${registro.sha256}): ${registro.resultado}${registro.ameaca ? ` ${registro.ameaca}` : ''}; VirusTotal: ${registro.vtSituacao}${deCampanha}`);
  return {
    mensagem: mensagemDoResultado(registro.ameaca),
    dados: paraDto(registro),
  };
}

type RegistroComCampanha = Awaited<ReturnType<typeof repo.criar>>;

function paraDto(r: RegistroComCampanha, usuario?: { nome: string; email: string }): AnaliseDto {
  return {
    id: r.id,
    nome: r.nome,
    tamanho: r.tamanho,
    sha256: r.sha256,
    resultado: r.resultado as AnaliseDto['resultado'],
    ameaca: r.ameaca,
    analisadoEm: r.criadoEm,
    segundaOpiniao: segundaOpiniaoDto(r),
    regraPropria: ehRegraPropria(r.ameaca),
    campanha: r.campaignEvent?.campaign ?? null,
    ...(usuario ? { usuario } : {}),
  };
}

/**
 * Historico (B17), paginado no servidor e filtrado por resultado: o Colaborador ve so as
 * proprias analises (o dono vem do login, nunca da query); operadores veem todas, com quem
 * enviou. O `total` do resumo segue o mesmo criterio (dono e filtro).
 */
export async function listar(usuario: UsuarioAtual, f: FiltrosHistorico) {
  const operador = OPERADORES.includes(usuario.perfil);
  const { registros, total } = await repo.listar(
    { userId: operador ? undefined : usuario.id, resultado: f.resultado },
    f.pagina,
    f.tamanho,
  );
  const lista: AnaliseDto[] = registros.map((r) =>
    paraDto(r, operador ? { nome: r.user.nome, email: r.user.email } : undefined),
  );
  return { lista, resumo: { total, pagina: f.pagina, tamanho: f.tamanho } };
}

/**
 * Arquivos maliciosos no risco tecnico do dashboard (B17): arquivos DISTINTOS por SHA-256 com
 * veredito AMEACA do ClamAV nos ultimos 30 dias, de todos os usuarios. O mesmo arquivo enviado
 * varias vezes (ou por varias pessoas) conta uma vez. A segunda opiniao do VirusTotal nao entra:
 * o veredito e so do ClamAV, como no historico.
 */
export function contarArquivosMaliciosos(agora = new Date()): Promise<number> {
  return repo.contarAmeacasDistintasDesde(inicioDaJanela(agora));
}

/** Inicio da janela de 30 dias que termina em `fim`. */
function inicioDaJanela(fim: Date): Date {
  return new Date(fim.getTime() - JANELA_ARQUIVOS_MALICIOSOS_DIAS * 24 * 60 * 60 * 1000);
}

/**
 * A mesma contagem de `contarArquivosMaliciosos`, mas com a janela terminando em cada instante
 * de `fins` (evolucao do risco, B25b): o KPI que o dashboard teria mostrado ao fim de cada dia.
 * Devolve um numero por instante, na ordem de `fins`.
 */
export async function contarArquivosMaliciososAte(fins: Date[]): Promise<number[]> {
  if (!fins.length) return [];
  const linhas = await repo.contarAmeacasDistintasPorJanela(fins.map((fim) => ({ desde: inicioDaJanela(fim), ate: fim })));
  const porDia = new Map(linhas.map((l) => [Number(l.dia), Number(l.total)]));
  return fins.map((_, i) => porDia.get(i + 1) ?? 0);
}

// ---- Anexo suspeito de campanha (B23) ---------------------------------------------

/** Quantas campanhas recebidas a tela lista (as mais recentes). */
const CAMPANHAS_RECEBIDAS_MAXIMO = 50;

/**
 * Campanhas que o usuario recebeu, para ligar o anexo a uma delas. Com `link` (token do e-mail,
 * vindo da pagina publica do treinamento ou do reporte), `selecionada` traz o evento desse link
 * se ele for do proprio usuario; link alheio ou desconhecido da `null`, sem erro e sem dizer
 * de quem e. O token so e comparado pelo hash, como no treinamento.
 */
export async function campanhasRecebidas(usuario: UsuarioAtual, link?: string) {
  const eventos = await repo.campanhasRecebidas(usuario.id, CAMPANHAS_RECEBIDAS_MAXIMO);
  const lista: CampanhaRecebidaDto[] = eventos.map((e) => ({
    id: e.id,
    campanha: e.campaign,
    recebidaEm: e.enviadoEm,
    anexosEnviados: e._count.anexos,
  }));
  const doLink = link ? await repo.eventoDoLink(link, usuario.id) : null;
  return { lista, resumo: { selecionada: doLink && lista.some((c) => c.id === doLink) ? doLink : null } };
}

/** Anexos reportados numa campanha, com os vereditos (relatorio dos operadores). */
export async function anexosDaCampanha(campaignId: string) {
  const anexos: AnexoCampanhaDto[] = (await repo.anexosDaCampanha(campaignId)).map((a) => ({
    id: a.id,
    nome: a.nome,
    sha256: a.sha256,
    resultado: a.resultado as ResultadoAnalise,
    ameaca: a.ameaca,
    regraPropria: ehRegraPropria(a.ameaca),
    analisadoEm: a.criadoEm,
    destinatario: a.campaignEvent!.destinatario,
  }));
  return {
    total: anexos.length,
    ameacas: anexos.filter((a) => a.resultado === 'AMEACA').length,
    regrasProprias: anexos.filter((a) => a.regraPropria).length,
    lista: anexos,
  };
}
