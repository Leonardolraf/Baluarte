import type { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { exigeToken } from '../auth.js';
import { enviar, erro } from '../util.js';

// -----------------------------------------------------------------------------
// Endpoints de LEITURA/AGREGACAO que alimentam as telas do frontend.
// Sao adicionais ao contrato da N2 AT1 (que vive em api.ts) — nenhum deles
// altera as rotas testadas pela collection do Postman.
// -----------------------------------------------------------------------------

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      console.error('[erro interno]', e);
      if (!res.headersSent) erro(res, 500, 'Erro interno no servidor', 'ERRO_INTERNO');
    });
  };
}

type FindingComScan = { id: string; categoriaOwasp: string; cvss: number; severidade: string; descricao: string; evidencia: string; status: string; criadoEm: Date; scan: { asset: { host: string; nome: string } } };

function mapFinding(f: FindingComScan) {
  return {
    id: f.id,
    ativo: f.scan.asset.host,
    ativoNome: f.scan.asset.nome,
    categoria: f.categoriaOwasp,
    cvss: f.cvss,
    severidade: f.severidade,
    status: f.status,
    descricao: f.descricao,
    evidencia: f.evidencia,
    detectadoEm: f.criadoEm,
  };
}

function funilDe(eventos: { enviadoEm: Date | null; abertoEm: Date | null; clicadoEm: Date | null; submeteuEm: Date | null; reportouEm: Date | null }[]) {
  const enviados = eventos.filter((e) => e.enviadoEm).length;
  const abertos = eventos.filter((e) => e.abertoEm).length;
  const clicados = eventos.filter((e) => e.clicadoEm).length;
  const submeteram = eventos.filter((e) => e.submeteuEm).length;
  const reportaram = eventos.filter((e) => e.reportouEm).length;
  const pct = (n: number) => (enviados ? Math.round((n / enviados) * 100) : 0);
  return {
    enviados: { valor: enviados, pct: 100 },
    abertos: { valor: abertos, pct: pct(abertos) },
    clicados: { valor: clicados, pct: pct(clicados) },
    submeteram: { valor: submeteram, pct: pct(submeteram) },
    reportaram: { valor: reportaram, pct: pct(reportaram) },
  };
}

function mapCampaign(c: { id: string; nome: string; template: string; status: string; criadoEm: Date; eventos: { enviadoEm: Date | null; clicadoEm: Date | null }[] }) {
  const enviados = c.eventos.filter((e) => e.enviadoEm).length;
  const clicados = c.eventos.filter((e) => e.clicadoEm).length;
  return {
    id: c.id,
    nome: c.nome,
    template: c.template,
    status: c.status,
    destinatarios: c.eventos.length,
    taxaClique: enviados ? Math.round((clicados / enviados) * 100) : 0,
    criadoEm: c.criadoEm,
  };
}

export function registerReadRoutes(r: Router) {
  // ---- Usuario logado ----
  r.get('/me', exigeToken, wrap(async (req, res) => {
    const u = (req as Request & { usuario?: { idUsuario: string } }).usuario!;
    const user = await prisma.user.findUnique({ where: { id: u.idUsuario }, select: { id: true, nome: true, email: true, perfil: true, status: true } });
    enviar(res, 200, { status: 'sucesso', dados: user });
  }));

  // ---- Dashboard agregado ----
  r.get('/dashboard', exigeToken, wrap(async (_req, res) => {
    const findings = await prisma.finding.findMany({ include: { scan: { include: { asset: true } } }, orderBy: { criadoEm: 'desc' } }) as unknown as FindingComScan[];
    const abertas = findings.filter((f) => f.status !== 'Resolvida').length;
    const criticas = findings.filter((f) => f.cvss >= 9.0 && f.status !== 'Resolvida').length;
    const ativos = await prisma.asset.count();

    const sev: Record<string, number> = { 'Crítico': 0, 'Alto': 0, 'Médio': 0, 'Baixo': 0 };
    for (const f of findings) if (f.status !== 'Resolvida') sev[f.severidade] = (sev[f.severidade] || 0) + 1;

    const campanhas = await prisma.campaign.findMany({ include: { eventos: true }, orderBy: { criadoEm: 'desc' } });
    const totalEnviados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.enviadoEm).length, 0);
    const totalClicados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.clicadoEm).length, 0);
    const resiliencia = totalEnviados ? Math.round((1 - totalClicados / totalEnviados) * 100) : 0;
    const ativa = campanhas.find((c) => c.status === 'ATIVA') || campanhas[0];

    enviar(res, 200, {
      status: 'sucesso',
      dados: {
        kpis: { vulnerabilidadesAbertas: abertas, criticas, resilienciaPhishing: resiliencia, ativosMonitorados: ativos },
        distribuicaoSeveridade: sev,
        vulnerabilidadesRecentes: findings.slice(0, 5).map(mapFinding),
        alertas: findings.slice(0, 3).map((f) => ({ id: f.id, severidade: f.severidade, texto: `${f.categoriaOwasp} em ${f.scan.asset.host}`, cvss: f.cvss, quando: f.criadoEm })),
        campanhas: campanhas.map(mapCampaign),
        funil: ativa ? funilDe(ativa.eventos) : null,
        campanhaAtiva: ativa ? ativa.nome : null,
      },
    });
  }));

  // ---- Ativos ----
  r.get('/assets', exigeToken, wrap(async (_req, res) => {
    const assets = await prisma.asset.findMany({ include: { _count: { select: { scans: true } } }, orderBy: { criadoEm: 'desc' } });
    enviar(res, 200, { status: 'sucesso', dados: assets });
  }));

  // ---- Varreduras ----
  r.get('/scans', exigeToken, wrap(async (_req, res) => {
    const scans = await prisma.scan.findMany({ include: { asset: true, _count: { select: { findings: true } } }, orderBy: { criadoEm: 'desc' } });
    enviar(res, 200, { status: 'sucesso', dados: scans });
  }));

  // ---- Vulnerabilidades (findings achatados) com filtros ?severidade= ?status= ?q= ----
  r.get('/vulnerabilidades', exigeToken, wrap(async (req, res) => {
    let findings = await prisma.finding.findMany({ include: { scan: { include: { asset: true } } }, orderBy: { criadoEm: 'desc' } }) as unknown as FindingComScan[];
    const { severidade, status, q } = req.query as Record<string, string>;
    if (severidade) findings = findings.filter((f) => f.severidade.toLowerCase() === severidade.toLowerCase());
    if (status) findings = findings.filter((f) => f.status.toLowerCase() === status.toLowerCase());
    if (q) {
      const termo = q.toLowerCase();
      findings = findings.filter((f) => f.scan.asset.host.toLowerCase().includes(termo) || f.categoriaOwasp.toLowerCase().includes(termo));
    }
    const lista = findings.map(mapFinding);
    const ativosDistintos = new Set(findings.map((f) => f.scan.asset.host)).size;
    enviar(res, 200, { status: 'sucesso', dados: lista, resumo: { total: lista.length, ativos: ativosDistintos } });
  }));

  // ---- Detalhe de vulnerabilidade ----
  r.get('/vulnerabilidades/:id', exigeToken, wrap(async (req, res) => {
    const f = await prisma.finding.findUnique({ where: { id: req.params.id }, include: { scan: { include: { asset: true } } } }) as unknown as FindingComScan | null;
    if (!f) return erro(res, 404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
    enviar(res, 200, { status: 'sucesso', dados: mapFinding(f) });
  }));

  // ---- Alterar status da vulnerabilidade ----
  r.patch('/vulnerabilidades/:id', exigeToken, wrap(async (req, res) => {
    const { status } = req.body ?? {};
    const PERMITIDOS = ['Aberta', 'Em revisão', 'Em remediação', 'Resolvida'];
    if (!PERMITIDOS.includes(status)) return erro(res, 400, 'Status inválido', 'STATUS_INVALIDO');
    const existe = await prisma.finding.findUnique({ where: { id: req.params.id } });
    if (!existe) return erro(res, 404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
    const f = await prisma.finding.update({ where: { id: req.params.id }, data: { status }, include: { scan: { include: { asset: true } } } }) as unknown as FindingComScan;
    enviar(res, 200, { status: 'sucesso', mensagem: 'Status atualizado', dados: mapFinding(f) });
  }));

  // ---- Campanhas (lista com metricas) ----
  r.get('/campanhas', exigeToken, wrap(async (_req, res) => {
    const campanhas = await prisma.campaign.findMany({ include: { eventos: true }, orderBy: { criadoEm: 'desc' } });
    const ativas = campanhas.filter((c) => c.status === 'ATIVA').length;
    const totalEnviados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.enviadoEm).length, 0);
    const totalClicados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.clicadoEm).length, 0);
    const colaboradores = campanhas.reduce((a, c) => a + c.eventos.length, 0);
    enviar(res, 200, {
      status: 'sucesso',
      dados: campanhas.map(mapCampaign),
      resumo: {
        ativas,
        taxaMediaClique: totalEnviados ? Math.round((totalClicados / totalEnviados) * 100) : 0,
        colaboradoresAlcancados: colaboradores,
        resilienciaMedia: totalEnviados ? Math.round((1 - totalClicados / totalEnviados) * 100) : 0,
      },
    });
  }));

  // ---- Relatorio de campanha (funil + treinamentos) ----
  r.get('/campanhas/:id', exigeToken, wrap(async (req, res) => {
    const c = await prisma.campaign.findUnique({ where: { id: req.params.id }, include: { eventos: true } });
    if (!c) return erro(res, 404, 'Campanha não encontrada', 'CAMPANHA_NAO_ENCONTRADA');
    enviar(res, 200, {
      status: 'sucesso',
      dados: {
        id: c.id, nome: c.nome, template: c.template, status: c.status, criadoEm: c.criadoEm,
        destinatarios: c.eventos.length,
        funil: funilDe(c.eventos),
        treinamentos: c.eventos.filter((e) => e.clicadoEm).map((e) => ({ destinatario: e.destinatario, concluido: e.treinou })),
      },
    });
  }));

  // ---- Usuarios (RBAC) ----
  r.get('/usuarios', exigeToken, wrap(async (_req, res) => {
    const usuarios = await prisma.user.findMany({ select: { id: true, nome: true, email: true, perfil: true, status: true, criadoEm: true }, orderBy: { criadoEm: 'asc' } });
    const resumo = {
      total: usuarios.length,
      Administrador: usuarios.filter((u) => u.perfil === 'Administrador').length,
      Analista: usuarios.filter((u) => u.perfil === 'Analista').length,
      Colaborador: usuarios.filter((u) => u.perfil === 'Colaborador').length,
    };
    enviar(res, 200, { status: 'sucesso', dados: usuarios, resumo });
  }));

  // ---- Configuracoes de seguranca (politica documentada, leitura) ----
  r.get('/configuracoes/seguranca', exigeToken, wrap(async (_req, res) => {
    enviar(res, 200, {
      status: 'sucesso',
      dados: {
        politicaSenha: { comprimentoMinimo: 8, exigirMaiusculaMinuscula: true, exigirNumeroEspecial: true },
        sessao: { algoritmoToken: 'JWT HS256', expiracaoMinutos: 30, limiteTentativasLogin: 5, doisFatores: false },
        auditoria: { logImutavel: true, retencaoMeses: 12 },
      },
    });
  }));

  // ---- Treinamento pos-clique (publico, acessado pelo link da campanha) ----
  r.get('/treinamentos/:token', wrap(async (req, res) => {
    const evento = await prisma.campaignEvent.findUnique({ where: { id: req.params.token }, include: { campaign: true } });
    enviar(res, 200, {
      status: 'sucesso',
      dados: {
        tipoAtaque: 'Phishing por Urgência',
        titulo: 'Como reconhecer urgência artificial',
        codigoModulo: 'US-005',
        duracaoMin: 8,
        progresso: evento?.treinou ? 100 : 0,
        campanha: evento?.campaign?.nome ?? null,
        sinaisAlerta: ['Pressão por ação imediata', 'Remetente desconhecido ou disfarçado', 'Links que não batem com o domínio oficial'],
        boasPraticas: ['Confira o remetente real', 'Passe o mouse sobre os links antes de clicar', 'Na dúvida, reporte ao time de TI'],
      },
    });
  }));
}
