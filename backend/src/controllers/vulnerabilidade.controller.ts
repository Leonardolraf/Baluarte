import type { Request, Response } from 'express';
import { ALTERACAO_STATUS, CLASSIFICACAO } from '../models/vulnerabilidade.model.js';
import * as vulnerabilidadeService from '../services/vulnerabilidade.service.js';
import { enviar } from '../utils/resposta.js';
import { textoDeQuery, validar } from '../utils/esquemas.js';

// Controller de vulnerabilidades (achados) e da classificacao CVSS publica.

/** GET /findings/classificacao?cvss=X (contrato N2 AT1; publico). */
export async function classificar(req: Request, res: Response) {
  validar(req.query, CLASSIFICACAO);
  return enviar(res, 200, { status: 'sucesso', dados: vulnerabilidadeService.classificar(Number(req.query.cvss)) });
}

/** GET /vulnerabilidades?severidade=&status=&q= (Administrador/Analista). */
export async function listar(req: Request, res: Response) {
  // Coage a string: `?severidade[]=x` / `?q[$ne]=x` viram objeto/array no parser do Express.
  const { lista, resumo } = await vulnerabilidadeService.listar({
    severidade: textoDeQuery.parse(req.query.severidade),
    status: textoDeQuery.parse(req.query.status),
    q: textoDeQuery.parse(req.query.q),
  });
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/** GET /vulnerabilidades/:id. */
export async function detalhe(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await vulnerabilidadeService.detalhe(req.params.id) });
}

/** PATCH /vulnerabilidades/:id (status, "Risco aceito" incluso). */
export async function alterarStatus(req: Request, res: Response) {
  const { status } = validar(req.body, ALTERACAO_STATUS);
  const dados = await vulnerabilidadeService.alterarStatus(req.params.id, String(status));
  enviar(res, 200, { status: 'sucesso', mensagem: 'Status atualizado', dados });
}
