import type { FileScan } from '@prisma/client';
import { z } from 'zod';
import { msDoAmbiente } from '../utils/ambiente.js';
import { idRecurso, regra, regrasDePaginacao, seVeio, umDe } from '../utils/esquemas.js';
import type { SegundaOpiniaoDto } from './segundaOpiniao.model.js';

// Analise de arquivo pelo antivirus (B04). O arquivo nunca e gravado: passa em fluxo pelo
// ClamAV e e descartado; fica so o registro (nome para exibir, tamanho, SHA-256, veredito).

export type AnaliseArquivo = FileScan;

/**
 * Tamanho maximo aceito por arquivo, em MB de 1024 x 1024 bytes (o mesmo que a tela barra antes
 * de enviar). Toda a cadeia acompanha este numero: busboy (controller), Nginx do servico `app`
 * (`client_max_body_size` da rota de analise) e clamd (`StreamMaxLength` no docker-compose.yml).
 * Os limites do clamd que cortam em silencio (`MaxFileSize`, `MaxHTMLNormalize`,
 * `MaxScriptNormalize`, `PCREMaxFileSize`) ficam acima da cota (`MaxScanSize`), que avisa com
 * `AlertExceedsMax`; abaixo dela, o clamd responderia "OK" sem ter lido tudo (medido).
 */
export const LIMITE_ARQUIVO_MB = 250;
export const LIMITE_ARQUIVO_BYTES = LIMITE_ARQUIVO_MB * 1024 * 1024;
export const MENSAGEM_ARQUIVO_GRANDE = `Arquivo maior que o limite de ${LIMITE_ARQUIVO_MB} MB`;

/** Analises por usuario por hora (o antivirus e caro: cada envio ocupa o clamd). */
export const LIMITE_ANALISES_POR_HORA = 20;

/**
 * Analises EM ANDAMENTO ao mesmo tempo por usuario (Melhorias #18). Sem prazo total no envio
 * (so ociosidade e o teto de 30 min), mandar 1 byte a cada 59 s seguraria ate 20 envios abertos
 * por usuario, com os sockets e o INSTREAM do clamd: um slowloris autenticado. A terceira leva
 * 429 ANALISES_SIMULTANEAS.
 */
export const LIMITE_ANALISES_SIMULTANEAS = 2;

/**
 * Heartbeat da vaga reservada (DT09, tabela FileScanReserva; Melhorias #18). Enquanto o envio ou
 * a varredura estao em curso, o `criadoEm` da reserva e renovado a cada intervalo. A reserva
 * conta nos limites (20/h, 2 simultaneas, 5 por evento) e segura a exclusao da campanha so
 * enquanto esta em dia; a que deixa de ser renovada (API reiniciada, deploy, processo que caiu)
 * libera a vaga sozinha. Nao ha limpeza na subida: varias instancias podem usar o mesmo banco.
 * `RESERVA_RENOVACAO_MS` sobrescreve o intervalo (os testes usam fracoes de segundo).
 */
export const INTERVALO_RENOVACAO_RESERVA_PADRAO_MS = 60_000;
export const intervaloRenovacaoReservaMs = () => msDoAmbiente('RESERVA_RENOVACAO_MS', INTERVALO_RENOVACAO_RESERVA_PADRAO_MS);

/** Renovacoes seguidas que podem falhar (banco lento, UPDATE perdido) sem a reserva vencer. */
export const RENOVACOES_PERDIDAS_TOLERADAS = 4;

/**
 * Validade da reserva: o intervalo do heartbeat com a folga das renovacoes perdidas
 * (60 s x (4 + 1) = 5 min). Orfa libera a vaga em ate 5 min; analise em curso nunca vence,
 * porque e renovada bem antes.
 */
export const validadeReservaAnaliseMs = () => intervaloRenovacaoReservaMs() * (RENOVACOES_PERDIDAS_TOLERADAS + 1);

/** Campo do formulario multipart que leva o arquivo. */
export const CAMPO_ARQUIVO = 'arquivo';

/** O resultado diz o que o antivirus sabe: ameaca CONHECIDA. Nunca afirma "arquivo seguro". */
export const MENSAGEM_LIMPO = 'Nenhuma ameaça conhecida encontrada';
export const mensagemAmeaca = (ameaca: string) => `Ameaça encontrada: ${ameaca}`;

/** Veredito do antivirus (espelha a CHECK da coluna `resultado`). */
export const RESULTADOS_ANALISE = ['LIMPO', 'AMEACA'] as const;
export type ResultadoAnalise = (typeof RESULTADOS_ANALISE)[number];

// ---- Historico (GET /arquivos/analises, B17) --------------------------------------

/** Tamanho padrao e maximo da pagina do historico. */
export const TAMANHO_PAGINA_PADRAO = 20;
export const TAMANHO_PAGINA_MAXIMO = 100;

/** Filtros ja validados e convertidos. */
export interface FiltrosHistorico {
  resultado?: ResultadoAnalise;
  pagina: number;
  tamanho: number;
}

/** Regras da query do historico, na ordem em que sao checadas (objeto/array da 400, nunca 500). */
export const CONSULTA_HISTORICO = [
  regra(
    'resultado',
    seVeio(umDe(RESULTADOS_ANALISE)),
    'Filtro de resultado inválido: use LIMPO ou AMEACA',
    'RESULTADO_INVALIDO',
  ),
  ...regrasDePaginacao(TAMANHO_PAGINA_MAXIMO),
];

// ---- Peso no dashboard (B17) -------------------------------------------------------

/**
 * Janela dos arquivos maliciosos no risco tecnico: so as deteccoes dos ultimos 30 dias contam.
 * O arquivo e descartado na analise e nao tem status para "resolver"; sem janela, uma deteccao
 * antiga pesaria como critica para sempre.
 */
export const JANELA_ARQUIVOS_MALICIOSOS_DIAS = 30;

/** Analise como a API devolve. `usuario` so aparece para Administrador/Analista. */
export interface AnaliseDto {
  id: string;
  nome: string;
  tamanho: number;
  sha256: string;
  resultado: ResultadoAnalise;
  ameaca: string | null;
  analisadoEm: Date;
  /** Segunda opiniao do VirusTotal (B20); null nas analises anteriores a ela. Nao muda `resultado`. */
  segundaOpiniao: SegundaOpiniaoDto | null;
  /** B23: a deteccao veio de uma regra YARA propria do Baluarte (antivirus/regras), nao do ClamAV. */
  regraPropria: boolean;
  /** B23: anexo suspeito de uma campanha de phishing simulado; null no envio avulso. */
  campanha: CampanhaDeOrigem | null;
  usuario?: { nome: string; email: string };
}

/**
 * Nome so para exibir: sem caminho (fica o ultimo trecho depois de / ou \), sem caracteres de
 * controle, ate 255 caracteres. Nunca e usado como caminho de arquivo.
 */
export function nomeParaExibir(original: string | undefined): string {
  const base = (original ?? '').split(/[\\/]/).pop() ?? '';
  const limpo = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return limpo || 'arquivo-sem-nome';
}

// ---- Regras YARA proprias (B23) -------------------------------------------------------

/**
 * O ClamAV nomeia a deteccao de uma regra YARA como `YARA.<regra>.UNOFFICIAL`. As regras do
 * Baluarte (antivirus/regras/baluarte_*.yar) comecam com `Baluarte`; so elas ganham o rotulo de
 * regra propria. Regra YARA de terceiros que alguem jogue no diretorio de banco nao ganha.
 */
const DETECCAO_REGRA_PROPRIA = /^YARA\.Baluarte[A-Za-z0-9_]*\.UNOFFICIAL$/;

/** A ameaca encontrada veio de uma regra propria do Baluarte? */
export function ehRegraPropria(ameaca: string | null | undefined): boolean {
  return typeof ameaca === 'string' && DETECCAO_REGRA_PROPRIA.test(ameaca);
}

/** Rotulo que acompanha a deteccao de regra propria na mensagem e na tela. */
export const ROTULO_REGRA_PROPRIA = 'regra própria do Baluarte';

/**
 * Com `AlertExceedsMax yes` (docker-compose.yml), arquivo que passa de um limite do clamd
 * (tamanho, cota de varredura, profundidade ou quantidade de arquivos dentro de um compactado)
 * volta como `Heuristics.Limits.Exceeded.<Limite>` em vez de "OK": nao foi analisado por inteiro
 * e conta como ameaca, por precaucao (decisao do Leo, Melhorias #18).
 */
const DETECCAO_LIMITE_EXCEDIDO = /^Heuristics\.Limits\.Exceeded(\.[A-Za-z0-9_]+)?$/;

/** A "ameaca" e o clamd dizendo que nao conseguiu olhar o arquivo inteiro? */
export function ehLimiteExcedido(ameaca: string | null | undefined): boolean {
  return typeof ameaca === 'string' && DETECCAO_LIMITE_EXCEDIDO.test(ameaca);
}

/** Rotulo que traduz o nome tecnico do limite excedido na mensagem e na tela. */
export const ROTULO_LIMITE_EXCEDIDO = 'passa dos limites de análise do antivírus; tratado como ameaça por precaução';

// ---- Zip64 (DT27) -------------------------------------------------------------------

/**
 * O ClamAV 1.5.4 nao le a entrada de zip cujo cabecalho LOCAL traz 0xFFFFFFFF no tamanho
 * comprimido ou no original com o bit 3 da flag (descritor de dados) desligado: o tamanho real so
 * esta no campo extra Zip64, que ele nao le (Cisco-Talos/clamav#1527, medido na 1.5.4), e ele
 * responde "OK" sem ter lido o conteudo; nenhuma opcao do clamd muda isso. As outras formas de
 * Zip64 (tamanhos reais no local, descritor de dados, Zip64 so no central/EOCD64) ele le. A API
 * procura essa forma no proprio fluxo (`utils/detectorZip64.ts`), inclusive em zip comprimido
 * dentro de zip, e, se o clamd nao achou nada, o veredito vira AMEACA por precaucao (criterio
 * (iii), decisao do Leo; a politica e a mesma do limite excedido).
 *
 * Nome proprio, no espaco `Baluarte.`, e nao `Heuristics.Limits.Exceeded.Zip64`: (1) quem le a
 * auditoria saberia que a deteccao veio da API, nao do clamd (o `Heuristics.*` e do ClamAV, e um
 * dia ele pode emitir esse nome com outro sentido); (2) nao e limite excedido: um zip de 200
 * bytes cai aqui, e o rotulo "passa dos limites" mentiria.
 */
export const AMEACA_ZIP64 = 'Baluarte.Zip64.NaoAnalisavel';
/** A busca pela forma nao lida nao chegou ao fim (teto de descompressao ou de aninhamento). */
export const AMEACA_ZIP64_INCOMPLETA = 'Baluarte.Zip64.VerificacaoIncompleta';

export const ROTULO_ZIP64 = 'formato Zip64, que o antivírus não analisa; tratado como ameaça por precaução';
export const ROTULO_ZIP64_INCOMPLETA =
  'a busca por Zip64 passou do limite de descompressão ou de aninhamento; tratado como ameaça por precaução';

/**
 * Tetos da busca dentro de compactados (contra zip-bomba). O de bytes acompanha a cota do clamd
 * (`MaxScanSize` 1000M no docker-compose.yml, conferido em tests/unidade/config-clamd.test.ts):
 * o que passa dele o clamd tambem nao varre, e avisa. O de profundidade e o `MaxRecursion`
 * padrao do ClamAV (17), que tambem avisa acima dele.
 */
export const LIMITE_DESCOMPRESSAO_ZIP64_BYTES = 1000 * 1024 * 1024;
export const PROFUNDIDADE_MAXIMA_ZIP64 = 17;

/** A "ameaca" e a API dizendo que achou o Zip64 nao lido (ou nao conseguiu terminar de procurar)? */
export function ehZip64(ameaca: string | null | undefined): boolean {
  return ameaca === AMEACA_ZIP64 || ameaca === AMEACA_ZIP64_INCOMPLETA;
}

/**
 * Junta o veredito do clamd com a busca pelo Zip64 que ele nao le. Deteccao do clamd vale como veio
 * (o nome dela diz mais); "limpo" so fica limpo se essa forma nao aparece e a busca foi ate o fim.
 */
export function vereditoComZip64<V extends { resultado: ResultadoAnalise; ameaca: string | null }>(
  clamd: V,
  busca: { zip64: boolean; incompleta: boolean },
): { resultado: ResultadoAnalise; ameaca: string | null } {
  if (clamd.resultado === 'AMEACA') return { resultado: clamd.resultado, ameaca: clamd.ameaca };
  if (busca.zip64) return { resultado: 'AMEACA', ameaca: AMEACA_ZIP64 };
  if (busca.incompleta) return { resultado: 'AMEACA', ameaca: AMEACA_ZIP64_INCOMPLETA };
  return { resultado: clamd.resultado, ameaca: clamd.ameaca };
}

/** Mensagem do resultado: regra propria, limite excedido e Zip64 dizem de onde veio. */
export function mensagemDoResultado(ameaca: string | null): string {
  if (!ameaca) return MENSAGEM_LIMPO;
  if (ehRegraPropria(ameaca)) return `${mensagemAmeaca(ameaca)} (${ROTULO_REGRA_PROPRIA})`;
  if (ehLimiteExcedido(ameaca)) return `${mensagemAmeaca(ameaca)} (${ROTULO_LIMITE_EXCEDIDO})`;
  if (ameaca === AMEACA_ZIP64) return `${mensagemAmeaca(ameaca)} (${ROTULO_ZIP64})`;
  if (ameaca === AMEACA_ZIP64_INCOMPLETA) return `${mensagemAmeaca(ameaca)} (${ROTULO_ZIP64_INCOMPLETA})`;
  return mensagemAmeaca(ameaca);
}

// ---- Anexo suspeito de campanha (B23) -------------------------------------------------

/** Campanha de onde veio o anexo (o id e o da campanha, para a tela; nunca o token do link). */
export interface CampanhaDeOrigem {
  id: string;
  nome: string;
}

/**
 * Anexos por destinatario em cada campanha. Um e-mail de phishing raramente traz mais que dois
 * ou tres anexos; o teto impede que um envio repetido infle o relatorio da campanha. O limite
 * por hora (LIMITE_ANALISES_POR_HORA) e o de tamanho continuam valendo.
 */
export const LIMITE_ANEXOS_POR_CAMPANHA = 5;

/** Token do link do e-mail da campanha (gerarTokenLink: 32 bytes em hexadecimal). */
const tokenDeLink = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Query de POST /arquivos/analise. A origem vai na query (e nao num campo do multipart) para ser
 * conferida ANTES de ler o corpo: campanha alheia ou inexistente nem chega a ocupar o antivirus.
 */
export const ORIGEM_ANALISE = [
  regra('eventoCampanha', seVeio(idRecurso), 'Campanha de origem inválida', 'EVENTO_CAMPANHA_INVALIDO'),
];

/** Query de GET /arquivos/campanhas-recebidas: `link` opcional (token do e-mail) para pre-selecionar. */
export const CONSULTA_CAMPANHAS_RECEBIDAS = [
  regra('link', seVeio(tokenDeLink), 'Link de campanha inválido', 'LINK_INVALIDO'),
];

/** Campanha recebida pelo usuario, como a tela de analise lista. */
export interface CampanhaRecebidaDto {
  /** id do evento (destinatario na campanha): e o que vai em `eventoCampanha` no envio. */
  id: string;
  campanha: CampanhaDeOrigem;
  recebidaEm: Date | null;
  anexosEnviados: number;
}

/** Anexo reportado, como o relatorio da campanha mostra aos operadores. */
export interface AnexoCampanhaDto {
  id: string;
  nome: string;
  sha256: string;
  resultado: ResultadoAnalise;
  ameaca: string | null;
  regraPropria: boolean;
  analisadoEm: Date;
  destinatario: string;
}
