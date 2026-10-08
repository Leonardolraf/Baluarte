import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigePerfil, exigeToken, usuarioDe } from '../../http/middlewares.js';
import { DOMINIO_INTERNO, OPERADORES, TEMPLATES } from '../../shared/dominio.js';
import { emailFormatoValido, textoPreenchido } from '../../shared/validacao.js';
import * as campanhas from './service.js';

export function rotasCampanhas(r: Router) {
  // ---- POST /api/campaigns (contrato N2 AT1; Administrador/Analista) ----
  // Contrato original: um `destinatario`. Extensao compativel: `destinatarios[]`
  // (o frontend novo envia os dois; o Postman/Robot continuam enviando so o primeiro).
  r.post('/campaigns', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { nome, destinatario, destinatarios, template } = req.body ?? {};
    if (!textoPreenchido(nome)) return erro(res, 400, 'Nome da campanha é obrigatório', 'NOME_OBRIGATORIO');

    const brutos: unknown[] = Array.isArray(destinatarios) && destinatarios.length > 0 ? destinatarios : [destinatario];
    const emails: string[] = [];
    for (const item of brutos) {
      if (!emailFormatoValido(item)) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
      const email = String(item).trim();
      if (!email.toLowerCase().endsWith(DOMINIO_INTERNO))
        return erro(res, 422, 'Destinatário não autorizado: apenas e-mails internos', 'DESTINATARIO_EXTERNO');
      if (!emails.some((e) => e.toLowerCase() === email.toLowerCase())) emails.push(email);
    }
    if (!TEMPLATES.includes(template)) return erro(res, 400, 'Template é obrigatório', 'TEMPLATE_OBRIGATORIO');

    const dados = await campanhas.criar(usuarioDe(req).id, { nome, template, emails });
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Campanha criada com sucesso', dados });
  }));

  // ---- GET /campanhas (lista com metricas) ----
  r.get('/campanhas', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    const { lista, resumo } = await campanhas.listar();
    enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
  }));

  // ---- GET /campanhas/:id (relatorio) ----
  r.get('/campanhas/:id', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await campanhas.relatorio(req.params.id) });
  }));

  // ---- DELETE /campanhas/:id (Administrador/Analista) ----
  r.delete('/campanhas/:id', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    await campanhas.excluir(usuarioDe(req).id, req.params.id);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Campanha excluída' });
  }));
}
