// B14 — cruzamento do inventario das estacoes com as bases publicas de vulnerabilidades.
// O inventario chega pelas rotas do agente (osquery simulado com fetch, como em agente.test.ts)
// e o OSV e o NVD sao um servidor HTTP FALSO local (OSV_API_URL / NVD_API_URL): nenhuma rede
// real. Cobre: achados com CVE/CVSS/severidade ligados a estacao, cache no banco (com validade),
// nao duplicacao, dashboard contando, falha e tempo esgotado da base externa, RBAC da rota e o
// cruzamento automatico depois do inventario. Banco isolado (baluarte_test_cruzamento).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { ANALISTA, ADMIN, baixar, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';
import { textoDoPdf } from './pdf.js';

prepararBanco(import.meta.url);

const SEGREDO = randomBytes(24).toString('hex');
process.env.OSQUERY_ENROLL_SECRET = SEGREDO;

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { aguardarSegundoPlano } = await import('../src/services/cruzamento.service.js');

// ---- OSV e NVD falsos --------------------------------------------------------------

const V = {
  medio: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L', // 5.3
  alto30: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', // 7.5
  alto: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', // 7.8
  altoUI: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H', // 8.8
  critico: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', // 9.8
};

/** Ids que o querybatch devolve por ecossistema|pacote|versao (o resto: nenhuma vulnerabilidade). */
const OSV_IDS: Record<string, string[]> = {
  'Ubuntu:22.04:LTS|openssl|3.0.2-0ubuntu1.10': ['UBUNTU-CVE-2023-5678', 'USN-6450-1'],
  'Ubuntu:22.04:LTS|openssl|3.0.2-0ubuntu1.11': ['UBUNTU-CVE-2023-5678'],
  'Ubuntu:22.04:LTS|curl|7.81.0-1ubuntu1.13': ['UBUNTU-CVE-2023-38545', 'UBUNTU-CVE-2023-99999', 'UBUNTU-CVE-2020-0001', 'UBUNTU-CVE-2024-11111'],
  'Ubuntu:22.04:LTS|curl|7.81.0-1ubuntu1.15': ['UBUNTU-CVE-2023-38545'],
  'Ubuntu:22.04:LTS|curl|7.81.0-1ubuntu1.16': ['UBUNTU-CVE-2023-38545'],
  'Debian:12|glibc|2.36-9+deb12u3': ['DEBIAN-CVE-2023-4911'],
};

const OSV_VULNS: Record<string, unknown> = {
  'UBUNTU-CVE-2023-5678': {
    id: 'UBUNTU-CVE-2023-5678',
    summary: 'Excessive time spent in DH check',
    upstream: ['CVE-2023-5678'],
    severity: [{ type: 'Ubuntu', score: 'low' }, { type: 'CVSS_V3', score: `${V.medio}/E:U/RL:O` }],
    affected: [{ package: { name: 'openssl', ecosystem: 'Ubuntu:22.04:LTS' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '3.0.2-0ubuntu1.12' }] }] }],
  },
  'USN-6450-1': {
    id: 'USN-6450-1',
    summary: 'OpenSSL vulnerabilities',
    upstream: ['CVE-2023-5678', 'CVE-2023-3817'],
    severity: [{ type: 'Ubuntu', score: 'medium' }],
    affected: [{ package: { name: 'openssl', ecosystem: 'Ubuntu:22.04:LTS' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '3.0.2-0ubuntu1.12' }] }] }],
  },
  'UBUNTU-CVE-2023-38545': {
    id: 'UBUNTU-CVE-2023-38545',
    summary: 'SOCKS5 heap buffer overflow',
    upstream: ['CVE-2023-38545'],
    severity: [{ type: 'CVSS_V3', score: V.critico }],
    affected: [{ package: { name: 'curl', ecosystem: 'Ubuntu:22.04:LTS' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '7.81.0-1ubuntu1.14' }] }] }],
  },
  'UBUNTU-CVE-2023-99999': {
    id: 'UBUNTU-CVE-2023-99999',
    summary: 'Sem nota',
    upstream: ['CVE-2023-99999'],
    severity: [{ type: 'Ubuntu', score: 'negligible' }],
    affected: [{ package: { name: 'curl', ecosystem: 'Ubuntu:22.04:LTS' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '7.81.0-1ubuntu1.14' }] }] }],
  },
  // DT17: afeta a versao instalada, tem nota, mas a distribuicao ainda nao publicou correcao.
  'UBUNTU-CVE-2024-11111': {
    id: 'UBUNTU-CVE-2024-11111',
    summary: 'Ainda sem correcao',
    upstream: ['CVE-2024-11111'],
    severity: [{ type: 'CVSS_V3', score: V.critico }],
    affected: [{ package: { name: 'curl', ecosystem: 'Ubuntu:22.04:LTS' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }] }] }],
  },
  'UBUNTU-CVE-2020-0001': { id: 'UBUNTU-CVE-2020-0001', upstream: ['CVE-2020-0001'], withdrawn: '2021-01-01T00:00:00Z', severity: [{ type: 'CVSS_V3', score: V.critico }] },
  'CVE-2023-99999': { id: 'CVE-2023-99999', details: 'Registro do CVE sem nota' },
  'DEBIAN-CVE-2023-4911': { id: 'DEBIAN-CVE-2023-4911', details: 'glibc: buffer overflow in ld.so', affected: [{ package: { name: 'glibc', ecosystem: 'Debian:12' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '2.36-9+deb12u3' }] }] }] },
  'CVE-2023-4911': { id: 'CVE-2023-4911', summary: 'Looney Tunables', severity: [{ type: 'CVSS_V3', score: V.alto }], database_specific: { cwe_ids: ['CWE-787'] } },
};

const cveNvd = (id: string, metrics: Record<string, unknown>, cwe?: string, configurations?: unknown[]) => ({
  cve: { id, vulnStatus: 'Analyzed', descriptions: [{ lang: 'en', value: `Descricao ${id}` }], metrics, weaknesses: cwe ? [{ description: [{ lang: 'en', value: cwe }] }] : [], configurations },
});
/** Configuracao do NVD: o produto afetado ate uma versao (exclusive) ou so numa versao exata. */
const ate = (criteria: string, versionEndExcluding?: string) => [{ nodes: [{ operator: 'OR', negate: false, cpeMatch: [{ vulnerable: true, criteria, ...(versionEndExcluding ? { versionEndExcluding } : {}) }] }] }];
const CHROME = 'cpe:2.3:a:google:chrome:*:*:*:*:*:*:*:*';
const v31 = (vetor: string, type = 'Primary') => ({ cvssMetricV31: [{ source: 'nvd@nist.gov', type, cvssData: { version: '3.1', vectorString: vetor } }] });

const NVD_CVE: Record<string, unknown> = {
  'CVE-2023-3817': cveNvd('CVE-2023-3817', { cvssMetricV30: [{ type: 'Primary', cvssData: { version: '3.0', vectorString: V.alto30 } }] }, 'CWE-834'),
  'CVE-2023-99999': cveNvd('CVE-2023-99999', { cvssMetricV2: [{ cvssData: { vectorString: 'AV:N/AC:L/Au:N/C:P/I:P/A:P' } }] }),
};
const NVD_CPE: Record<string, unknown[] | null> = {
  'cpe:2.3:a:google:chrome:129.0.6668.58:*:*:*:*:*:*:*': [
    cveNvd('CVE-2024-9602', v31(V.altoUI), 'CWE-843', ate(CHROME, '129.0.6668.70')),
    cveNvd('CVE-2024-9603', {}, undefined, ate(CHROME, '129.0.6668.70')),
    // DT17: so a versao exata na configuracao, sem versionEndExcluding: nenhuma correcao conhecida.
    cveNvd('CVE-2024-9604', v31(V.critico), undefined, ate('cpe:2.3:a:google:chrome:129.0.6668.58:*:*:*:*:*:*:*')),
  ],
  'cpe:2.3:a:7-zip:7-zip:23.01:*:*:*:*:*:*:*': null, // 404: CPE fora do dicionario
};

type Modo = 'normal' | 'erro' | 'mudo';
const modo: { OSV: Modo; NVD: Modo } = { OSV: 'normal', NVD: 'normal' };
const pedidos: { base: 'OSV' | 'NVD'; caminho: string; corpo: string; apiKey?: string }[] = [];
const conta = (base: 'OSV' | 'NVD') => pedidos.filter((p) => p.base === base).length;

function json(res: ServerResponse, status: number, corpo?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(corpo === undefined ? '' : JSON.stringify(corpo));
}

function tratar(req: IncomingMessage, res: ServerResponse) {
  let corpo = '';
  req.on('data', (d) => (corpo += d));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://falso');
    const base = url.pathname.startsWith('/nvd') ? 'NVD' : 'OSV';
    pedidos.push({ base, caminho: req.url ?? '', corpo, apiKey: req.headers.apikey as string | undefined });
    if (modo[base] === 'mudo') return; // nunca responde: forca o tempo limite
    if (modo[base] === 'erro') return json(res, 503, { erro: 'fora do ar' });
    if (base === 'NVD') {
      const cpe = url.searchParams.get('cpeName');
      const cve = url.searchParams.get('cveId');
      if (cpe) {
        const lista = cpe in NVD_CPE ? NVD_CPE[cpe] : [];
        return lista === null ? json(res, 404) : json(res, 200, { totalResults: lista.length, vulnerabilities: lista });
      }
      const item = cve ? NVD_CVE[cve] : undefined;
      return json(res, 200, { totalResults: item ? 1 : 0, vulnerabilities: item ? [item] : [] });
    }
    if (url.pathname === '/osv/v1/querybatch') {
      const { queries } = JSON.parse(corpo) as { queries: { package: { name: string; ecosystem: string }; version: string }[] };
      return json(res, 200, {
        results: queries.map((q) => {
          const ids = OSV_IDS[`${q.package.ecosystem}|${q.package.name}|${q.version}`];
          return ids ? { vulns: ids.map((id) => ({ id, modified: '2024-01-01T00:00:00Z' })) } : {};
        }),
      });
    }
    const id = decodeURIComponent(url.pathname.replace('/osv/v1/vulns/', ''));
    return id in OSV_VULNS ? json(res, 200, OSV_VULNS[id]) : json(res, 404, { code: 5, message: 'Bug not found.' });
  });
}

let falso: Server;
let analista = '';

before(async () => {
  await iniciarServidor(app);
  falso = createServer(tratar);
  await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
  process.env.OSV_API_URL = `${url}/osv`;
  process.env.NVD_API_URL = `${url}/nvd`;
  process.env.VULN_TIMEOUT_MS = '2000';
  analista = await login(ANALISTA.email, ANALISTA.senha);
});
after(async () => {
  await aguardarSegundoPlano();
  falso.closeAllConnections();
  await new Promise<void>((ok) => falso.close(() => ok()));
  await encerrarServidor();
  await prisma.$disconnect();
});
afterEach(async () => {
  await aguardarSegundoPlano();
  modo.OSV = 'normal';
  modo.NVD = 'normal';
  pedidos.length = 0;
  process.env.VULN_TIMEOUT_MS = '2000';
  delete process.env.NVD_API_KEY;
  delete process.env.CRUZAMENTO_AUTOMATICO;
});

// ---- Estacoes simuladas (protocolo do osquery) ---------------------------------------

let seq = 0;
type Linha = Record<string, string>;
const UBUNTU = { name: 'Ubuntu', version: '22.04.4 LTS (Jammy Jellyfish)', platform: 'ubuntu', build: '' };
const DEBIAN = { name: 'Debian GNU/Linux', version: '12 (bookworm)', platform: 'debian', build: '' };
const WINDOWS = { name: 'Microsoft Windows 11 Pro', version: '10.0.22631', platform: 'windows', build: '22631' };

function evento(nome: string, hostIdentifier: string, linhas: Linha[]) {
  return { name: nome, hostIdentifier, action: 'snapshot', snapshot: linhas, calendarTime: 'x', unixTime: 1, epoch: 0, counter: 0, numerics: false };
}

/** Inscreve uma estacao e devolve o envio de inventario dela. */
async function estacao(so: typeof UBUNTU) {
  seq += 1;
  const hostIdentifier = `b14-${seq}-${randomBytes(4).toString('hex')}`;
  const host = `estacao-b14-${seq}.empresa.local`;
  const r = await chamar('POST', '/agentes/osquery/enroll', {
    body: { enroll_secret: SEGREDO, host_identifier: hostIdentifier, host_details: { os_version: so, system_info: { hostname: host } } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const nodeKey = r.body.node_key as string;
  const ws = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
  const enviar = (query: string, linhas: Linha[]) =>
    chamar('POST', '/agentes/osquery/logger', { body: { node_key: nodeKey, log_type: 'result', data: [evento(query, hostIdentifier, linhas)] } });
  return { id: ws.id, assetId: ws.assetId, host, enviar };
}

const deb = (name: string, version: string, origem = '') => ({ name, version, fornecedor: 'Ubuntu Developers', origem });

async function estacaoUbuntu(versaoCurl = '7.81.0-1ubuntu1.13', versaoOpenssl = '3.0.2-0ubuntu1.10') {
  const e = await estacao(UBUNTU);
  const r = await e.enviar('baluarte_programas_deb', [
    deb('libssl3', versaoOpenssl, 'openssl'),
    deb('openssl', versaoOpenssl),
    deb('curl', versaoCurl),
    deb('bash', '5.1-6ubuntu1'),
  ]);
  assert.deepEqual(r.body, {});
  return e;
}

const verificar = (id: string, token = analista) => chamar('POST', `/estacoes/${id}/verificar`, { token });

// ---- Testes ------------------------------------------------------------------------

describe('verificação sob demanda (POST /estacoes/:id/verificar)', () => {
  it('Ubuntu: cada CVE com nota vira achado ligado à estação, com CVE, CVSS e severidade', async () => {
    const e = await estacaoUbuntu();
    const r = await verificar(e.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'sucesso');
    assert.equal(r.body.mensagem, 'Verificação concluída');
    const d = r.body.dados;
    assert.equal(d.estacaoId, e.id);
    assert.equal(d.ativoId, e.assetId);
    assert.equal(d.programasConsultados, 4);
    assert.equal(d.vulnerabilidadesEncontradas, 5, 'CVE-2023-5678 e -3817 no openssl; -38545, -99999 e -2024-11111 no curl (o retirado não conta)');
    assert.equal(d.achadosNovos, 3);
    assert.equal(d.achadosExistentes, 0);
    assert.equal(d.semCvss, 1, 'CVE-2023-99999 não tem vetor 3.x em nenhuma base: não vira achado');
    assert.equal(d.semCorrecao, 1, 'DT17: CVE-2024-11111 tem nota crítica, mas não tem versão corrigida: não vira achado');
    assert.deepEqual(d.falhas, []);
    assert.ok(d.varreduraId);

    const achados = await prisma.finding.findMany({ where: { workstationId: e.id }, orderBy: { cvss: 'asc' }, include: { scan: true } });
    assert.deepEqual(
      achados.map((f) => [f.cve, f.programa, f.programaVersao, f.cvss, f.severidade, f.baseVulnerabilidade, f.cvssVetor]),
      [
        ['CVE-2023-5678', 'openssl', '3.0.2-0ubuntu1.10', 5.3, 'Médio', 'OSV', V.medio],
        ['CVE-2023-3817', 'openssl', '3.0.2-0ubuntu1.10', 7.5, 'Alto', 'OSV', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N'],
        ['CVE-2023-38545', 'curl', '7.81.0-1ubuntu1.13', 9.8, 'Crítico', 'OSV', V.critico],
      ],
    );
    for (const f of achados) {
      assert.equal(f.categoriaOwasp, 'A06:2021 - Vulnerable and Outdated Components');
      assert.equal(f.status, 'Aberta');
      assert.equal(f.scanId, d.varreduraId);
      assert.equal(f.scan.assetId, e.assetId, 'a varredura é do ativo da estação');
      assert.equal(f.scan.status, 'CONCLUIDA');
    }
    // B25b: cada achado novo nasce com o evento de criacao do historico (NULL -> Aberta), no instante do achado.
    const eventos = await prisma.findingStatusChange.findMany({ where: { findingId: { in: achados.map((f) => f.id) } } });
    assert.equal(eventos.length, achados.length);
    for (const f of achados) {
      const ev = eventos.find((x) => x.findingId === f.id)!;
      assert.deepEqual([ev.de, ev.para, ev.usuarioId], [null, 'Aberta', null]);
      assert.equal(ev.registradaEm.getTime(), f.criadoEm.getTime());
    }
    assert.equal(achados[1].cwe, 'CWE-834', 'CWE do NVD quando o OSV não traz');
    assert.match(achados[0].evidencia, /deb_packages: libssl3, openssl; OSV Ubuntu:22\.04:LTS/);
    assert.match(JSON.stringify(achados[2].remediacao), /7\.81\.0-1ubuntu1\.14 ou mais nova/);
    const ws = await prisma.workstation.findUniqueOrThrow({ where: { id: e.id } });
    assert.ok(ws.verificadaEm && ws.verificadaEm.getTime() > Date.now() - 60_000);

    // A varredura da verificacao ja nasce concluida: o progresso calculado (B26) e 100%.
    const scan = (await chamar('GET', `/scans/${d.varreduraId}`, { token: analista })).body.dados;
    assert.equal(scan.status, 'CONCLUIDA');
    assert.equal(scan.progresso, 100);
    assert.equal(scan.etapa, 'Concluída');

    // OSV: 1 querybatch + 6 registros + 2 registros de CVE (fallback); NVD: 2 CVEs sem nota no OSV.
    // O CVE sem correcao nao gasta consulta atras de nota.
    assert.equal(conta('OSV'), 9);
    assert.equal(conta('NVD'), 2);
    assert.ok(!pedidos.some((p) => p.caminho.endsWith('/vulns/CVE-2024-11111') || p.caminho.includes('cveId=CVE-2024-11111')), 'nada consultado atrás da nota do CVE sem correção');
    const lote = JSON.parse(pedidos.find((p) => p.caminho.endsWith('/querybatch'))!.corpo);
    assert.deepEqual(lote.queries.map((q: { package: { name: string } }) => q.package.name).sort(), ['bash', 'curl', 'openssl'], 'libssl3 vira o pacote-fonte openssl');
  });

  it('registra na auditoria quem pediu e os achados gravados', async () => {
    const e = await estacaoUbuntu();
    const r = await verificar(e.id);
    assert.equal(r.status, 200);
    const analistaId = (await prisma.user.findUniqueOrThrow({ where: { email: ANALISTA.email } })).id;
    const pedido = await prisma.auditLog.findFirst({ where: { acao: 'VERIFICAR_ESTACAO', detalhe: { startsWith: `${e.host}:` } } });
    assert.equal(pedido?.usuarioId, analistaId);
    const escrita = await prisma.auditLog.findFirst({ where: { acao: 'REGISTRAR_ACHADOS_ESTACAO', detalhe: { contains: e.host } } });
    assert.ok(escrita, 'a escrita dos achados vai para o AuditLog');
    assert.match(escrita.detalhe!, /3 achado\(s\) novo\(s\).*CVE-2023-38545 \(curl\)/);
  });

  it('segunda verificação: nada duplicado, nenhuma varredura nova e nenhuma consulta externa (cache)', async () => {
    const e = await estacaoUbuntu();
    await verificar(e.id);
    pedidos.length = 0;
    const scansAntes = await prisma.scan.count({ where: { assetId: e.assetId } });
    const r = await verificar(e.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.achadosNovos, 0);
    assert.equal(r.body.dados.achadosExistentes, 3);
    assert.equal(r.body.dados.varreduraId, null);
    assert.equal(await prisma.finding.count({ where: { workstationId: e.id } }), 3);
    assert.equal(await prisma.scan.count({ where: { assetId: e.assetId } }), scansAntes);
    assert.equal(pedidos.length, 0, 'tudo veio do cache do banco');
    assert.equal(await prisma.findingStatusChange.count({ where: { finding: { workstationId: e.id } } }), 3, 'nenhum evento de criação repetido (B25b)');
  });

  it('cache vencido: consulta de novo, guarda com validade nova e continua sem duplicar', async () => {
    const e = await estacaoUbuntu();
    await verificar(e.id);
    const chave = 'consulta:Ubuntu:22.04:LTS|curl|7.81.0-1ubuntu1.13';
    const entrada = await prisma.vulnerabilityCache.findUniqueOrThrow({ where: { base_chave: { base: 'OSV', chave } } });
    assert.deepEqual(entrada.dados, { ids: ['UBUNTU-CVE-2023-38545', 'UBUNTU-CVE-2023-99999', 'UBUNTU-CVE-2020-0001', 'UBUNTU-CVE-2024-11111'] });
    const horas = (entrada.expiraEm.getTime() - entrada.consultadoEm.getTime()) / 3600_000;
    assert.equal(horas, 24, 'validade padrão de 24 h');
    assert.ok(await prisma.vulnerabilityCache.findUnique({ where: { base_chave: { base: 'OSV', chave: 'consulta:Ubuntu:22.04:LTS|bash|5.1-6ubuntu1' } } }), 'resposta vazia também fica no cache');

    await prisma.vulnerabilityCache.updateMany({ data: { consultadoEm: new Date(Date.now() - 48 * 3600_000), expiraEm: new Date(Date.now() - 1000) } });
    pedidos.length = 0;
    const r = await verificar(e.id);
    assert.equal(r.body.dados.achadosNovos, 0);
    assert.ok(conta('OSV') >= 1, 'consultou o OSV de novo');
    const renovada = await prisma.vulnerabilityCache.findUniqueOrThrow({ where: { base_chave: { base: 'OSV', chave } } });
    assert.ok(renovada.expiraEm.getTime() > Date.now() + 23 * 3600_000);
    assert.equal(await prisma.finding.count({ where: { workstationId: e.id } }), 3);
  });

  it('DT17: o cache grava em lotes (mais de um lote, chave repetida fica a última) e renova no lugar', async () => {
    const { gravar } = await import('../src/repositories/baseVulnerabilidade.repository.js');
    const entradas = Array.from({ length: 450 }, (_, i) => ({ chave: `lote-dt17:${i}`, dados: { ids: [`X-${i}`] } }));
    entradas.push({ chave: 'lote-dt17:7', dados: { ids: ['ULTIMA'] } });
    await gravar('OSV', entradas, 3600_000);
    assert.equal(await prisma.vulnerabilityCache.count({ where: { chave: { startsWith: 'lote-dt17:' } } }), 450);
    const sete = await prisma.vulnerabilityCache.findUniqueOrThrow({ where: { base_chave: { base: 'OSV', chave: 'lote-dt17:7' } } });
    assert.deepEqual(sete.dados, { ids: ['ULTIMA'] });
    assert.equal((sete.expiraEm.getTime() - sete.consultadoEm.getTime()) / 1000, 3600, 'validade gravada como pedida');
    await gravar('OSV', [{ chave: 'lote-dt17:7', dados: { ids: ['RENOVADA'] } }], 7200_000);
    const renovada = await prisma.vulnerabilityCache.findUniqueOrThrow({ where: { base_chave: { base: 'OSV', chave: 'lote-dt17:7' } } });
    assert.equal(renovada.id, sete.id, 'renova a mesma linha (upsert)');
    assert.deepEqual(renovada.dados, { ids: ['RENOVADA'] });
    assert.ok(renovada.expiraEm.getTime() > sete.expiraEm.getTime());
  });

  it('o banco recusa o mesmo CVE no mesmo programa da mesma estação (unicidade)', async () => {
    const e = await estacaoUbuntu();
    await verificar(e.id);
    const f = await prisma.finding.findFirstOrThrow({ where: { workstationId: e.id } });
    const { id: _id, criadoEm: _c, remediacao: _r, ...copia } = f;
    await assert.rejects(prisma.finding.create({ data: { ...copia } }), (err: { code?: string }) => err.code === 'P2002');
  });

  it('Debian: registro sem nota busca o registro do CVE no OSV (pacote-fonte com versão própria)', async () => {
    const e = await estacao(DEBIAN);
    await e.enviar('baluarte_programas_deb', [{ name: 'libc6', version: '2.36-9+deb12u3', fornecedor: 'GNU Libc Maintainers', origem: 'glibc' }]);
    const r = await verificar(e.id);
    assert.equal(r.body.dados.achadosNovos, 1);
    const f = await prisma.finding.findFirstOrThrow({ where: { workstationId: e.id } });
    assert.deepEqual([f.cve, f.programa, f.cvss, f.severidade, f.cwe], ['CVE-2023-4911', 'glibc', 7.8, 'Alto', 'CWE-787']);
    assert.match(f.evidencia, /DEBIAN-CVE-2023-4911/);
    assert.equal(conta('NVD'), 0, 'o registro do CVE no OSV já tinha a nota');
  });

  it('Windows: programas da tabela consultados no NVD por CPE, com a chave no cabeçalho; o resto sem cobertura', async () => {
    process.env.NVD_API_KEY = 'chave-falsa-nvd-b14';
    const e = await estacao(WINDOWS);
    const env = await e.enviar('baluarte_programas_windows', [
      { name: 'Google Chrome', version: '129.0.6668.58', fornecedor: 'Google LLC' },
      { name: '7-Zip 23.01 (x64)', version: '23.01', fornecedor: 'Igor Pavlov' },
      { name: 'Sistema Interno da Empresa', version: '4.2', fornecedor: 'Empresa' },
    ]);
    assert.deepEqual(env.body, {}, JSON.stringify(env.body));
    const r = await verificar(e.assetId); // aceita o id do ativo da estação
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.dados;
    assert.equal(d.programasConsultados, 2);
    assert.equal(d.programasSemCobertura, 1);
    assert.equal(d.vulnerabilidadesEncontradas, 3);
    assert.equal(d.achadosNovos, 1);
    assert.equal(d.semCvss, 1);
    assert.equal(d.semCorrecao, 1, 'DT17: CVE-2024-9604 só tem a versão exata na configuração do NVD');
    const f = await prisma.finding.findFirstOrThrow({ where: { workstationId: e.id } });
    assert.deepEqual([f.cve, f.programa, f.programaVersao, f.cvss, f.severidade, f.baseVulnerabilidade, f.cwe], ['CVE-2024-9602', 'Google Chrome', '129.0.6668.58', 8.8, 'Alto', 'NVD', 'CWE-843']);
    assert.match(f.evidencia, /cpe:2\.3:a:google:chrome:129\.0\.6668\.58/);
    assert.match(JSON.stringify(f.remediacao), /129\.0\.6668\.70 ou mais nova/, 'a remediação traz a versão corrigida do NVD');
    assert.equal(conta('NVD'), 2);
    assert.ok(pedidos.filter((p) => p.base === 'NVD').every((p) => p.apiKey === 'chave-falsa-nvd-b14'));
    assert.equal(conta('OSV'), 0, 'Windows não vai ao OSV');
    const cache404 = await prisma.vulnerabilityCache.findUniqueOrThrow({ where: { base_chave: { base: 'NVD', chave: 'cpe:cpe:2.3:a:7-zip:7-zip:23.01:*:*:*:*:*:*:*' } } });
    assert.deepEqual(cache404.dados, { cves: [] }, 'CPE fora do dicionário (404) é "nenhum CVE", não falha');
  });

  it('DT17: cache do NVD gravado antes das versões corrigidas é consultado de novo (não some o CVE)', async () => {
    const cpe = 'cpe:2.3:a:google:chrome:129.0.6668.58:*:*:*:*:*:*:*';
    const antigo = { cves: [{ cve: 'CVE-2024-9602', vetor: V.altoUI, cwe: 'CWE-843', descricao: 'antes do DT17' }] };
    await prisma.vulnerabilityCache.upsert({
      where: { base_chave: { base: 'NVD', chave: `cpe:${cpe}` } },
      create: { base: 'NVD', chave: `cpe:${cpe}`, dados: antigo, consultadoEm: new Date(), expiraEm: new Date(Date.now() + 3600_000) },
      update: { dados: antigo, consultadoEm: new Date(), expiraEm: new Date(Date.now() + 3600_000) },
    });
    const e = await estacao(WINDOWS);
    await e.enviar('baluarte_programas_windows', [{ name: 'Google Chrome', version: '129.0.6668.58', fornecedor: 'Google LLC' }]);
    const r = await verificar(e.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dados.achadosNovos, 1, 'o CVE com correção entra mesmo com a entrada antiga no cache');
    assert.equal(conta('NVD'), 1, 'consultou o NVD de novo');
    const renovado = await prisma.vulnerabilityCache.findUniqueOrThrow({ where: { base_chave: { base: 'NVD', chave: `cpe:${cpe}` } } });
    assert.ok((renovado.dados as { cves: { correcoes?: unknown }[] }).cves.every((c) => Array.isArray(c.correcoes)), 'regravado com as versões corrigidas');
  });

  it('sem chave do NVD, no máximo 5 consultas por verificação; o resto fica pendente', async () => {
    const e = await estacao(WINDOWS);
    const nomes = ['Mozilla Firefox (x64 pt-BR)', 'Mozilla Thunderbird (x64 pt-BR)', 'WinSCP 6.3.5', 'Wireshark 4.2.6 x64', 'FileZilla 3.67.1', 'KeePass Password Safe 2.57', 'TeamViewer'];
    await e.enviar('baluarte_programas_windows', nomes.map((name, i) => ({ name, version: `9.${i}.1`, fornecedor: 'X' })));
    const r = await verificar(e.id);
    assert.equal(r.body.dados.programasConsultados, 7);
    assert.equal(conta('NVD'), 5);
    assert.equal(r.body.dados.pendentes, 2);
    pedidos.length = 0;
    const r2 = await verificar(e.id);
    assert.equal(conta('NVD'), 2, 'a próxima verificação consulta só o que faltou');
    assert.equal(r2.body.dados.pendentes, 0);
  });

  it('dashboard: os achados das estações contam junto com os do scanner', async () => {
    const painel = async (token: string) => (await chamar('GET', '/dashboard', { token })).body.dados;
    const antes = await painel(analista);
    const e = await estacaoUbuntu();
    await verificar(e.id);
    const depois = await painel(analista);
    assert.equal(depois.kpis.vulnerabilidadesAbertas - antes.kpis.vulnerabilidadesAbertas, 3);
    assert.equal(depois.kpis.criticas - antes.kpis.criticas, 1);
    assert.equal(depois.distribuicaoSeveridade['Médio'] - antes.distribuicaoSeveridade['Médio'], 1);
    assert.equal(depois.distribuicaoSeveridade['Alto'] - antes.distribuicaoSeveridade['Alto'], 1);
    assert.ok(depois.alertas.some((a: { texto: string }) => a.texto === `CVE-2023-38545 em curl (${e.host})`));

    const lista = await chamar('GET', `/vulnerabilidades?q=${encodeURIComponent(e.host)}`, { token: analista });
    assert.equal(lista.body.dados.length, 3);
    const curl = lista.body.dados.find((v: { cve: string }) => v.cve === 'CVE-2023-38545');
    assert.equal(curl.programa, 'curl');
    assert.equal(curl.programaVersao, '7.81.0-1ubuntu1.13');
    assert.equal(curl.baseVulnerabilidade, 'OSV');
    assert.equal(curl.severidade, 'Crítico');
    assert.equal((await chamar('GET', '/vulnerabilidades?q=CVE-2023-38545', { token: analista })).body.dados.length >= 1, true, 'busca pelo CVE');

    const porPrograma = (await chamar('GET', '/vulnerabilidades?q=openssl', { token: analista })).body.dados as { programa: string | null }[];
    assert.ok(porPrograma.length >= 2 && porPrograma.every((v) => v.programa === 'openssl'), 'busca pelo programa, no banco');

    // Colaborador (B10) so recebe a resiliencia: os KPIs tecnicos, inclusive os das estacoes, vem null.
    const colab = await login('colaborador@empresa.com', 'Colab@123');
    assert.equal((await painel(colab)).kpis.vulnerabilidadesAbertas, null);
  });
});

describe('relatório em PDF (B24) com os achados da estação', () => {
  it('o ativo é a estação; CVE, CVSS, severidade e programa aparecem; a busca pelo CVE também filtra', async () => {
    const e = await estacaoUbuntu();
    await verificar(e.id);
    const r = await baixar(`/vulnerabilidades/relatorio.pdf?q=${encodeURIComponent(e.host)}`, analista);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /application\/pdf/);
    const texto = textoDoPdf(r.corpo);
    for (const trecho of [e.host, 'CVE-2023-38545', 'CVE-2023-3817', 'CVE-2023-5678', '9.8', '7.5', '5.3', 'Crítico', 'curl 7.81.0-1ubuntu1.13', 'openssl 3.0.2-0ubuntu1.10', 'A06:2021'])
      assert.ok(texto.includes(trecho), `esperava "${trecho}" no PDF`);
    assert.ok(texto.indexOf('CVE-2023-38545') < texto.indexOf('CVE-2023-5678'), 'ordenado por CVSS');
    const porCve = textoDoPdf((await baixar('/vulnerabilidades/relatorio.pdf?q=CVE-2023-38545', analista)).corpo);
    assert.ok(porCve.includes('CVE-2023-38545') && !porCve.includes('CVE-2023-5678'), 'busca por CVE, como a lista');
  });
});

describe('detalhe da estação (GET /estacoes/:id)', () => {
  it('traz verificadaEm e a contagem de achados (todos e em aberto)', async () => {
    const e = await estacaoUbuntu();
    let d = (await chamar('GET', `/estacoes/${e.id}`, { token: analista })).body.dados;
    assert.equal(d.verificadaEm, null, 'nunca verificada');
    assert.equal(d.totalAchados, 0);
    assert.equal(d.achadosAbertos, 0);
    await verificar(e.id);
    const f = await prisma.finding.findFirstOrThrow({ where: { workstationId: e.id } });
    assert.equal((await chamar('PATCH', `/vulnerabilidades/${f.id}`, { token: analista, body: { status: 'Resolvida' } })).status, 200);
    d = (await chamar('GET', `/estacoes/${e.id}`, { token: analista })).body.dados;
    assert.ok(d.verificadaEm && Date.parse(d.verificadaEm) > Date.now() - 60_000);
    assert.equal(d.totalAchados, 3);
    assert.equal(d.achadosAbertos, 2, '"Resolvida" sai dos abertos');
    const lista = (await chamar('GET', '/estacoes', { token: analista })).body.dados;
    assert.equal(lista.find((x: { id: string }) => x.id === e.id).verificadaEm, d.verificadaEm);
  });
});

describe('falha da base externa', () => {
  it('OSV fora do ar: 200 com a falha listada, nenhum achado e nada no cache; depois volta e cria', async () => {
    const e = await estacaoUbuntu('7.81.0-1ubuntu1.15', '3.0.2-0ubuntu1.99');
    modo.OSV = 'erro';
    const r = await verificar(e.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.dados.falhas, ['OSV']);
    assert.equal(r.body.mensagem, 'Verificação concluída sem resposta de: OSV');
    assert.equal(r.body.dados.achadosNovos, 0);
    assert.equal(await prisma.finding.count({ where: { workstationId: e.id } }), 0);
    assert.equal(await prisma.vulnerabilityCache.count({ where: { chave: { contains: '7.81.0-1ubuntu1.15' } } }), 0, 'falha não vai para o cache');

    modo.OSV = 'normal';
    const r2 = await verificar(e.id);
    assert.deepEqual(r2.body.dados.falhas, []);
    assert.equal(r2.body.dados.achadosNovos, 1);
  });

  it('NVD fora do ar: o que depende dele fica para depois; o que o OSV confirmou entra', async () => {
    await prisma.vulnerabilityCache.deleteMany({ where: { base: 'NVD' } });
    const e = await estacaoUbuntu();
    modo.NVD = 'erro';
    const r = await verificar(e.id);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.falhas, ['NVD']);
    const cves = (await prisma.finding.findMany({ where: { workstationId: e.id } })).map((f) => f.cve).sort();
    assert.deepEqual(cves, ['CVE-2023-38545', 'CVE-2023-5678'], 'CVE-2023-3817 precisa do NVD: não vira achado sem nota');
    assert.equal(conta('NVD'), 1, 'depois da primeira falha não insiste no NVD');
  });

  it('tempo esgotado: responde dentro do limite, com a falha listada', async () => {
    const e = await estacaoUbuntu('7.81.0-1ubuntu1.16');
    process.env.VULN_TIMEOUT_MS = '300';
    modo.OSV = 'mudo';
    const inicio = Date.now();
    const r = await verificar(e.id);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.falhas, ['OSV']);
    assert.ok(Date.now() - inicio < 5000);
  });

  it('uma verificação por vez na mesma estação: a segunda recebe 409', async () => {
    const e = await estacaoUbuntu('7.81.0-1ubuntu1.17');
    process.env.VULN_TIMEOUT_MS = '1500';
    modo.OSV = 'mudo';
    const primeira = verificar(e.id);
    await new Promise((ok) => setTimeout(ok, 300));
    esperaErro(await verificar(e.id), 409, 'VERIFICACAO_EM_ANDAMENTO');
    assert.equal((await primeira).status, 200);
  });
});

describe('acesso e erros da rota', () => {
  it('Administrador também verifica; Colaborador 403; sem token 401', async () => {
    const e = await estacaoUbuntu();
    const admin = await login(ADMIN.email, ADMIN.senha);
    assert.equal((await verificar(e.id, admin)).status, 200);
    const colab = await login('colaborador@empresa.com', 'Colab@123');
    esperaErro(await verificar(e.id, colab), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', `/estacoes/${e.id}/verificar`), 401, 'TOKEN_AUSENTE');
  });

  it('id fora do formato 400 (regra do painel); estação inexistente ou ativo comum 404; ativo inativo 422', async () => {
    esperaErro(await verificar('nao-existe'), 400, 'ID_INVALIDO');
    esperaErro(await verificar('x'.repeat(65)), 400, 'ID_INVALIDO');
    esperaErro(await verificar(`c${'0'.repeat(24)}`), 404, 'ESTACAO_NAO_ENCONTRADA');
    const cad = await chamar('POST', '/assets', { token: analista, body: { nome: 'Servidor B14', tipo: 'Servidor', host: `srv-b14-${++seq}.empresa.local` } });
    assert.equal(cad.status, 201, JSON.stringify(cad.body));
    esperaErro(await verificar(cad.body.dados.id), 404, 'ESTACAO_NAO_ENCONTRADA');
    const e = await estacaoUbuntu();
    await prisma.asset.update({ where: { id: e.assetId }, data: { status: 'Inativo' } });
    esperaErro(await verificar(e.id), 422, 'ATIVO_INATIVO');
  });
});

describe('cruzamento automático depois do inventário', () => {
  it('desligado nos testes por padrão: o inventário só é guardado', async () => {
    const e = await estacaoUbuntu();
    await aguardarSegundoPlano();
    assert.equal(pedidos.length, 0);
    assert.equal(await prisma.finding.count({ where: { workstationId: e.id } }), 0);
  });

  it('CRUZAMENTO_AUTOMATICO=1: o logger responde {} e a verificação roda em segundo plano', async () => {
    process.env.CRUZAMENTO_AUTOMATICO = '1';
    const e = await estacaoUbuntu('7.81.0-1ubuntu1.13', '3.0.2-0ubuntu1.11');
    await aguardarSegundoPlano();
    const cves = (await prisma.finding.findMany({ where: { workstationId: e.id } })).map((f) => f.cve).sort();
    assert.deepEqual(cves, ['CVE-2023-38545', 'CVE-2023-5678']);
    const reg = await prisma.auditLog.findFirst({ where: { acao: 'REGISTRAR_ACHADOS_ESTACAO', detalhe: { contains: e.host } } });
    assert.equal(reg?.usuarioId, null, 'a escrita automática é auditada sem usuário');
  });

  it('base externa travada não segura nem derruba o recebimento do inventário', async () => {
    process.env.CRUZAMENTO_AUTOMATICO = '1';
    process.env.VULN_TIMEOUT_MS = '1500';
    modo.OSV = 'mudo';
    const e = await estacao(UBUNTU);
    const inicio = Date.now();
    const r = await e.enviar('baluarte_programas_deb', [deb('curl', '7.81.0-1ubuntu1.18')]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {});
    assert.ok(Date.now() - inicio < 1200, 'o agente não espera a base externa');
    await aguardarSegundoPlano();
    assert.equal(await prisma.finding.count({ where: { workstationId: e.id } }), 0);
    assert.equal((await prisma.workstationSoftware.count({ where: { workstationId: e.id } })), 1);
  });
});

// Por ultimo no arquivo: encerra os achados das outras estacoes para isolar o ranking.
describe('nota de risco do ativo (B25)', () => {
  it('os achados abertos da estação entram na nota do ativo-estação e no top 5 do dashboard', async () => {
    const e = await estacaoUbuntu();
    await verificar(e.id);
    await prisma.finding.updateMany({ where: { NOT: { workstationId: e.id } }, data: { status: 'Resolvida' } });

    // 1 Crítico (9.8) + 1 Alto (7.5) + 1 Médio (5.3): 10 + 7 + 4 = 21.
    const ativos = (await chamar('GET', '/assets', { token: analista })).body.dados as { id: string; notaRisco: number; achadosAbertos: number }[];
    const ativo = ativos.find((a) => a.id === e.assetId);
    assert.equal(ativo?.notaRisco, 21);
    assert.equal(ativo?.achadosAbertos, 3);

    let topo = (await chamar('GET', '/dashboard', { token: analista })).body.dados.ativosMaiorRisco as { id: string; host: string; notaRisco: number }[];
    assert.deepEqual(topo.map((a) => [a.host, a.notaRisco]), [[e.host, 21]]);

    // Resolver o Crítico baixa a nota na leitura seguinte (11 = 7 + 4).
    const critico = await prisma.finding.findFirstOrThrow({ where: { workstationId: e.id, severidade: 'Crítico' } });
    assert.equal((await chamar('PATCH', `/vulnerabilidades/${critico.id}`, { token: analista, body: { status: 'Resolvida' } })).status, 200);
    topo = (await chamar('GET', '/dashboard', { token: analista })).body.dados.ativosMaiorRisco;
    assert.equal(topo[0].notaRisco, 11);
  });
});
