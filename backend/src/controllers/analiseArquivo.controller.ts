import type { Request, Response } from 'express';
import busboy from 'busboy';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import {
  CAMPO_ARQUIVO, CONSULTA_CAMPANHAS_RECEBIDAS, CONSULTA_HISTORICO, LIMITE_ARQUIVO_BYTES, ORIGEM_ANALISE,
  TAMANHO_PAGINA_PADRAO, type ResultadoAnalise,
} from '../models/analiseArquivo.model.js';
import * as analiseService from '../services/analiseArquivo.service.js';
import type { FluxoArquivo } from '../services/analiseArquivo.service.js';
import { textoDeQuery, validar } from '../utils/esquemas.js';
import { ErroNegocio, enviar } from '../utils/resposta.js';

// Controller da analise de arquivos (B04). O corpo multipart e lido em fluxo pelo busboy: o
// arquivo vai direto ao antivirus e nunca e gravado em disco (e fica fora do limite de 64 kb
// do JSON, que so vale para application/json).

const SEM_ARQUIVO = () => new ErroNegocio(400, `Nenhum arquivo enviado (campo "${CAMPO_ARQUIVO}")`, 'ARQUIVO_OBRIGATORIO');

/** Le o multipart e entrega o primeiro arquivo do campo `arquivo` ao processamento dado. */
function receberArquivo<T>(req: Request, processar: (nome: string | undefined, fluxo: FluxoArquivo) => Promise<T>): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    let leitor: busboy.Busboy;
    try {
      // +1 byte: o arquivo de exatamente 10 MB passa; acima disso o busboy marca `truncated`.
      leitor = busboy({ headers: req.headers, limits: { files: 1, fileSize: LIMITE_ARQUIVO_BYTES + 1, fields: 5, fieldSize: 1024 } });
    } catch {
      return rejeitar(SEM_ARQUIVO()); // Content-Type ausente ou nao multipart
    }
    let processamento: Promise<T> | null = null;
    leitor.on('file', (campo, fluxo, info) => {
      if (campo !== CAMPO_ARQUIVO || processamento) {
        fluxo.resume(); // outros campos de arquivo sao descartados sem ler
        return;
      }
      processamento = processar(info.filename, fluxo as FluxoArquivo);
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
  let resultado;
  try {
    if (!/^multipart\/form-data/i.test(req.headers['content-type'] ?? '')) throw SEM_ARQUIVO();
    resultado = await receberArquivo(req, (nome, fluxo) => analiseService.analisar(usuario, nome, fluxo, vaga));
  } catch (e) {
    await analiseService.devolverVaga(vaga).catch((falha) => console.error('[analise] vaga não devolvida:', falha));
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
