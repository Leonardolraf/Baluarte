import type { Request, Response } from 'express';
import busboy from 'busboy';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import {
  CAMPO_ARQUIVO, CONSULTA_CAMPANHAS_RECEBIDAS, CONSULTA_HISTORICO, LIMITE_ARQUIVO_BYTES, ORIGEM_ANALISE,
  TAMANHO_PAGINA_PADRAO, type ResultadoAnalise,
} from '../models/analiseArquivo.model.js';
import * as analiseService from '../services/analiseArquivo.service.js';
import type { FluxoArquivo } from '../services/analiseArquivo.service.js';
import { ociosidadeEnvioMs, tetoEnvioMs, trocarPorOciosidade } from '../middlewares/tempoRequisicao.middleware.js';
import { textoDeQuery, validar } from '../utils/esquemas.js';
import { ErroNegocio, enviar } from '../utils/resposta.js';

// Controller da analise de arquivos (B04). O corpo multipart e lido em fluxo pelo busboy: o
// arquivo vai direto ao antivirus e nunca e gravado em disco (e fica fora do limite de 64 kb
// do JSON, que so vale para application/json).

const SEM_ARQUIVO = () => new ErroNegocio(400, `Nenhum arquivo enviado (campo "${CAMPO_ARQUIVO}")`, 'ARQUIVO_OBRIGATORIO');
const ENVIO_PARADO = () =>
  new ErroNegocio(408, `O envio ficou parado por mais de ${Math.round(ociosidadeEnvioMs() / 1000)} s sem receber dados`, 'ENVIO_PARADO');
const ENVIO_INTERROMPIDO = () => new ErroNegocio(400, 'A conexão caiu antes do fim do envio', 'ENVIO_INTERROMPIDO');
// Codigo proprio (e nao ENVIO_PARADO): o envio nao parou, so passou do teto; a tela pode dizer isso.
const ENVIO_TEMPO_MAXIMO = () =>
  new ErroNegocio(408, `O envio passou do tempo máximo de ${Math.round(tetoEnvioMs() / 60_000)} min`, 'ENVIO_TEMPO_MAXIMO');
/** Desfechos em que o cliente ainda esta no meio do corpo: responde e fecha a conexao. */
const FECHA_CONEXAO = new Set(['ENVIO_PARADO', 'ENVIO_TEMPO_MAXIMO']);

/**
 * Le o multipart e entrega o primeiro arquivo do campo `arquivo` ao processamento dado.
 *
 * Tempo de envio (decisao do Leo, Melhorias #18): aqui nao vale o total de 5 min das outras
 * rotas, e sim a OCIOSIDADE (`trocarPorOciosidade`): o arquivo de 250 MB pode subir devagar pelo
 * tempo que for, mas sem nenhum byte por 60 s o envio para com 408 ENVIO_PARADO. Conexao que cai
 * no meio tambem interrompe o processamento (antes ele ficava esperando o resto do arquivo, e a
 * vaga so voltava quando a reserva vencia). Nos dois casos o fluxo do arquivo e destruido com o
 * erro, o antivirus e abandonado e o controller devolve a vaga.
 */
function receberArquivo<T>(req: Request, processar: (nome: string | undefined, fluxo: FluxoArquivo) => Promise<T>): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    let leitor: busboy.Busboy;
    try {
      // +1 byte: o arquivo de exatamente 250 MB passa; acima disso o busboy marca `truncated`.
      leitor = busboy({ headers: req.headers, limits: { files: 1, fileSize: LIMITE_ARQUIVO_BYTES + 1, fields: 5, fieldSize: 1024 } });
    } catch {
      return rejeitar(SEM_ARQUIVO()); // Content-Type ausente ou nao multipart
    }
    let processamento: Promise<T> | null = null;
    let fluxoDoArquivo: FluxoArquivo | null = null;
    const interromper = (e: ErroNegocio) => {
      req.unpipe(leitor);
      if (fluxoDoArquivo && !fluxoDoArquivo.readableEnded) {
        fluxoDoArquivo.destroy(e); // o processamento rejeita com `e`, e o catch abaixo repassa
      } else if (processamento) {
        // O arquivo ja chegou inteiro (faltava so o fim do multipart): deixa a analise terminar.
        processamento.finally(() => rejeitar(e)).catch(() => undefined);
      } else {
        rejeitar(e);
      }
    };
    const pararOciosidade = trocarPorOciosidade(
      req,
      () => interromper(ENVIO_PARADO()),
      () => interromper(ENVIO_TEMPO_MAXIMO()),
    );
    req.once('close', () => {
      if (!req.complete) interromper(ENVIO_INTERROMPIDO());
    });
    leitor.on('file', (campo, fluxo, info) => {
      if (campo !== CAMPO_ARQUIVO || processamento) {
        fluxo.resume(); // outros campos de arquivo sao descartados sem ler
        return;
      }
      fluxoDoArquivo = fluxo as FluxoArquivo;
      processamento = processar(info.filename, fluxoDoArquivo);
      processamento.finally(pararOciosidade).catch(() => undefined);
      // Se o processamento parar no meio (413, antivirus fora), o fluxo do arquivo ja foi
      // destruido e o busboy nao termina sozinho: responde ja e descarta o resto do corpo.
      processamento.catch((e) => {
        req.unpipe(leitor);
        req.resume();
        rejeitar(e);
      });
    });
    leitor.on('close', () => {
      if (!processamento) return rejeitar(SEM_ARQUIVO());
      processamento.then(resolver, rejeitar);
    });
    leitor.on('error', (e) => rejeitar(e instanceof ErroNegocio ? e : SEM_ARQUIVO()));
    req.pipe(leitor);
  });
}

/** Parametro de query ja validado: string (vazio conta como ausente). */
const daQuery = (req: Request, campo: string) => textoDeQuery.parse(req.query[campo])?.trim() || undefined;

/**
 * POST /arquivos/analise[?eventoCampanha=<id do evento>] (os tres perfis). Com `eventoCampanha`
 * (B23), o arquivo e um anexo suspeito recebido naquela campanha; a origem e conferida antes de
 * ler o corpo.
 */
export async function analisar(req: Request, res: Response) {
  const usuario = usuarioDe(req);
  validar(req.query, ORIGEM_ANALISE);
  // A vaga nos limites de envio fica reservada daqui em diante (DT09); se a analise nao chegar
  // ao fim (corpo sem arquivo, 413, antivirus fora, qualquer erro), ela e devolvida.
  const vaga = await analiseService.verificarAntesDeReceber(usuario.id, daQuery(req, 'eventoCampanha'));
  // Heartbeat da reserva enquanto o envio ou a varredura estao em curso; para no `finally`, em
  // todo desfecho, ANTES de qualquer resposta (depois dela, nenhum UPDATE na reserva).
  const renovacao = analiseService.manterVagaViva(vaga);
  let resultado;
  try {
    try {
      if (!/^multipart\/form-data/i.test(req.headers['content-type'] ?? '')) throw SEM_ARQUIVO();
      resultado = await receberArquivo(req, (nome, fluxo) => analiseService.analisar(usuario, nome, fluxo, vaga));
    } finally {
      await renovacao.parar();
    }
  } catch (e) {
    await analiseService.devolverVaga(vaga).catch((falha) => console.error('[analise] vaga não devolvida:', falha));
    if (e instanceof ErroNegocio && FECHA_CONEXAO.has(e.codigo)) {
      // Cliente parado no meio do corpo: responde e fecha a conexao (nao ha resto a esperar).
      res.setHeader('Connection', 'close');
      res.once('finish', () => setImmediate(() => req.socket.destroy()));
    }
    throw e;
  }
  return enviar(res, 201, { status: 'sucesso', mensagem: resultado.mensagem, dados: resultado.dados });
}

/**
 * GET /arquivos/analises?resultado=&pagina=&tamanho= (historico; o Colaborador ve so o proprio).
 * `dados` continua sendo a lista; o `resumo` traz total, pagina e tamanho (B17).
 */
export async function listar(req: Request, res: Response) {
  validar(req.query, CONSULTA_HISTORICO);
  // Depois de validar, todo parametro presente e string; vazio conta como ausente.
  const q = (campo: string) => daQuery(req, campo);
  const { lista, resumo } = await analiseService.listar(usuarioDe(req), {
    resultado: q('resultado') as ResultadoAnalise | undefined,
    pagina: Number(q('pagina') ?? 1),
    tamanho: Number(q('tamanho') ?? TAMANHO_PAGINA_PADRAO),
  });
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/**
 * GET /arquivos/campanhas-recebidas[?link=<token do e-mail>] (os tres perfis, B23): as campanhas
 * que o proprio usuario recebeu, para ligar o anexo suspeito a uma delas.
 */
export async function campanhasRecebidas(req: Request, res: Response) {
  validar(req.query, CONSULTA_CAMPANHAS_RECEBIDAS);
  const { lista, resumo } = await analiseService.campanhasRecebidas(usuarioDe(req), daQuery(req, 'link'));
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}
