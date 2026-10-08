import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { SEVERIDADES, STATUS_FINDING } from '../models/dominio.model.js';
import {
  ALTERACAO_STATUS,
  CLASSIFICACAO,
  CONSULTA_LISTA,
  FILTROS_RELATORIO,
  ORDEM_PADRAO,
  TAMANHO_PADRAO,
  rotuloDaLista,
  type CampoOrdenacao,
  type Direcao,
  type FiltrosVulnerabilidade,
} from '../models/vulnerabilidade.model.js';
import * as vulnerabilidadeService from '../services/vulnerabilidade.service.js';
import { enviar, enviarArquivo } from '../utils/resposta.js';
import { textoDeQuery, validar } from '../utils/esquemas.js';

// Controller de vulnerabilidades (achados) e da classificacao CVSS publica.

/** GET /findings/classificacao?cvss=X (contrato N2 AT1; publico). */
export async function classificar(req: Request, res: Response) {
  validar(req.query, CLASSIFICACAO);
  return enviar(res, 200, { status: 'sucesso', dados: vulnerabilidadeService.classificar(Number(req.query.cvss)) });
}

/** Parametro de query ja validado; vazio (ou so espacos) conta como ausente. */
function parametro(req: Request, campo: string): string | undefined {
  return textoDeQuery.parse(req.query[campo])?.trim() || undefined;
}

/** Filtros validados no rotulo oficial (`alto` -> `Alto`): os mesmos na lista e no relatorio. */
function filtrosDe(req: Request): FiltrosVulnerabilidade {
  return {
    severidade: rotuloDaLista(SEVERIDADES, parametro(req, 'severidade')),
    status: rotuloDaLista(STATUS_FINDING, parametro(req, 'status')),
    q: parametro(req, 'q'),
  };
}

/**
 * GET /vulnerabilidades?severidade=&status=&q=&pagina=&tamanho=&ordenar=&direcao=
 * (Administrador/Analista). Paginada no servidor (padrao 20, maximo 100); sem `ordenar`, a
 * mais recente primeiro. Parametro invalido: 400 com codigo proprio.
 */
export async function listar(req: Request, res: Response) {
  validar(req.query, CONSULTA_LISTA);
  const ordenar = parametro(req, 'ordenar') as CampoOrdenacao | undefined;
  const { lista, resumo } = await vulnerabilidadeService.listar({
    filtros: filtrosDe(req),
    ordem: {
      campo: ordenar ?? ORDEM_PADRAO.campo,
      direcao: (parametro(req, 'direcao') as Direcao | undefined) ?? ORDEM_PADRAO.direcao,
    },
    pagina: Number(parametro(req, 'pagina') ?? 1),
    tamanho: Number(parametro(req, 'tamanho') ?? TAMANHO_PADRAO),
  });
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/** GET /vulnerabilidades/relatorio.pdf?severidade=&status=&q= (Administrador/Analista; B24). Exporta o filtro inteiro, sem paginar. */
export async function exportarRelatorio(req: Request, res: Response) {
  validar(req.query, FILTROS_RELATORIO);
  const { pdf, nomeArquivo } = await vulnerabilidadeService.exportarRelatorio(usuarioDe(req), filtrosDe(req));
  enviarArquivo(res, pdf, 'application/pdf', nomeArquivo);
}

/** GET /vulnerabilidades/:id (com a origem e o historico). */
export async function detalhe(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await vulnerabilidadeService.detalhe(req.params.id) });
}

/** PATCH /vulnerabilidades/:id (status, "Risco aceito" incluso). */
export async function alterarStatus(req: Request, res: Response) {
  const { status } = validar(req.body, ALTERACAO_STATUS);
  const dados = await vulnerabilidadeService.alterarStatus(usuarioDe(req).id, req.params.id, String(status));
  enviar(res, 200, { status: 'sucesso', mensagem: 'Status atualizado', dados });
}
