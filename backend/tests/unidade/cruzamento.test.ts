// Testes de UNIDADE do cruzamento do inventario com as bases de vulnerabilidades (B14): do
// pacote para a consulta (ecossistema do OSV, pacote-fonte), tabela Windows -> CPE, leitura das
// respostas do OSV e do NVD, vetor/nota/severidade do achado e os clientes HTTP contra um
// servidor FALSO local (nenhuma rede real).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CATEGORIA_COMPONENTE,
  dadosAchadoEstacao,
  ecossistemaOsv,
  lerCvesNvd,
  lerLoteOsv,
  lerVulnOsv,
  pacoteDeConsulta,
  validadeCacheHoras,
  vetorBase31,
  type AchadoEstacao,
} from '../../src/models/cruzamento.model.js';
import { cpeDoPrograma, TABELA_CPE_WINDOWS, versaoCpe } from '../../src/models/tabelaCpe.model.js';
import { BaseIndisponivel, obterJson, tempoLimiteMs } from '../../src/config/baseExterna.js';
import * as osv from '../../src/config/osv.js';
import * as nvd from '../../src/config/nvd.js';

const so = (soPlataforma: string | null, soVersao: string | null, soNome: string | null = null) => ({ soPlataforma, soVersao, soNome });

describe('pacote do inventário -> consulta ao OSV', () => {
  it('deb no Debian e no Ubuntu: ecossistema com a versão da distribuição (LTS com sufixo)', () => {
    assert.equal(ecossistemaOsv('deb_packages', so('debian', '12 (bookworm)')), 'Debian:12');
    assert.equal(ecossistemaOsv('deb_packages', so('ubuntu', '22.04.4 LTS (Jammy Jellyfish)')), 'Ubuntu:22.04:LTS');
    assert.equal(ecossistemaOsv('deb_packages', so('ubuntu', '24.04')), 'Ubuntu:24.04:LTS', 'xx.04 de ano par é LTS mesmo sem o rótulo');
    assert.equal(ecossistemaOsv('deb_packages', so('ubuntu', '23.10 (Mantic Minotaur)')), 'Ubuntu:23.10');
    assert.equal(ecossistemaOsv('deb_packages', so(null, '12 (bookworm)', 'Debian GNU/Linux')), 'Debian:12', 'sem platform, usa o nome do SO');
  });

  it('rpm no AlmaLinux e no Rocky; RHEL, SUSE, Windows e macOS ficam sem cobertura', () => {
    assert.equal(ecossistemaOsv('rpm_packages', so('almalinux', '9.4 (Seafoam Ocelot)')), 'AlmaLinux:9');
    assert.equal(ecossistemaOsv('rpm_packages', so('rocky', '8.10 (Green Obsidian)')), 'Rocky Linux:8');
    assert.equal(ecossistemaOsv('rpm_packages', so('rhel', '9.4')), null);
    assert.equal(ecossistemaOsv('rpm_packages', so('opensuse-leap', '15.6')), null);
    assert.equal(ecossistemaOsv('deb_packages', so('rocky', '9.4')), null, 'deb fora do Debian/Ubuntu');
    assert.equal(ecossistemaOsv('deb_packages', so('debian', null)), null, 'sem versão da distribuição não há ecossistema');
    assert.equal(ecossistemaOsv('deb_packages', so('ubuntu', 'desconhecida')), null);
    assert.equal(ecossistemaOsv('programs', so('windows', '10.0.22631')), null);
    assert.equal(ecossistemaOsv('apps', so('darwin', '14.6')), null);
  });

  it('deb consulta o pacote-fonte; a versão entre parênteses vence a do binário', () => {
    assert.deepEqual(pacoteDeConsulta({ nome: 'libssl3', versao: '3.0.2-0ubuntu1.10', pacoteOrigem: 'openssl' }), { nome: 'openssl', versao: '3.0.2-0ubuntu1.10' });
    assert.deepEqual(pacoteDeConsulta({ nome: 'gcc-12-base', versao: '12.2.0-14+b1', pacoteOrigem: 'gcc-12 (12.2.0-14)' }), { nome: 'gcc-12', versao: '12.2.0-14' });
    assert.deepEqual(pacoteDeConsulta({ nome: 'curl', versao: '7.81.0-1', pacoteOrigem: null }), { nome: 'curl', versao: '7.81.0-1' });
    assert.deepEqual(pacoteDeConsulta({ nome: 'curl', versao: '7.81.0-1', pacoteOrigem: '  ' }), { nome: 'curl', versao: '7.81.0-1' });
  });
});

describe('tabela Windows -> CPE do NVD', () => {
  it('casa o nome que o osquery lê e monta o CPE 2.3 com a versão do NVD', () => {
    assert.deepEqual(cpeDoPrograma('Google Chrome', '129.0.6668.58'), {
      programa: 'Google Chrome',
      versao: '129.0.6668.58',
      cpe: 'cpe:2.3:a:google:chrome:129.0.6668.58:*:*:*:*:*:*:*',
    });
    assert.equal(cpeDoPrograma('Mozilla Firefox (x64 pt-BR)', '131.0.2')?.cpe, 'cpe:2.3:a:mozilla:firefox:131.0.2:*:*:*:*:*:*:*');
    assert.equal(cpeDoPrograma('Mozilla Firefox ESR (x64 en-US)', '128.3.1')?.programa, 'Mozilla Firefox ESR', 'ESR antes do Firefox');
    assert.equal(cpeDoPrograma('7-Zip 23.01 (x64)', '23.01')?.cpe, 'cpe:2.3:a:7-zip:7-zip:23.01:*:*:*:*:*:*:*');
    assert.equal(cpeDoPrograma('PuTTY release 0.81 (64-bit)', '0.81.0.0')?.versao, '0.81');
    assert.equal(cpeDoPrograma('OpenVPN 2.6.12-I001 amd64', '2.6.12-I001')?.versao, '2.6.12');
    assert.equal(cpeDoPrograma('Notepad++ (64-bit x64)', '8.6.9')?.cpe, 'cpe:2.3:a:notepad-plus-plus:notepad\\+\\+:8.6.9:*:*:*:*:*:*:*');
  });

  it('programa fora da tabela, Edge WebView ou sem versão numérica não vira consulta', () => {
    assert.equal(cpeDoPrograma('Programa Interno da Empresa', '1.0'), null);
    assert.equal(cpeDoPrograma('Microsoft Edge WebView2 Runtime', '129.0.2792.79'), null);
    assert.equal(cpeDoPrograma('Google Chrome', ''), null);
    assert.equal(cpeDoPrograma('Google Chrome', 'beta'), null);
    assert.equal(versaoCpe('2.6.12-I001'), '2.6.12');
    assert.equal(versaoCpe('v1.0'), null);
  });

  it('a tabela cobre os programas mais comuns com CPE bem formado', () => {
    assert.ok(TABELA_CPE_WINDOWS.length >= 20);
    for (const l of TABELA_CPE_WINDOWS) assert.match(`cpe:2.3:a:${l.fornecedor}:${l.produto}`, /^cpe:2\.3:a:[a-z0-9_\-.\\+]+:[a-z0-9_\-.\\+]+$/, l.programa);
    assert.equal(new Set(TABELA_CPE_WINDOWS.map((l) => l.programa)).size, TABELA_CPE_WINDOWS.length, 'programa canônico sem repetição');
  });
});

describe('leitura das respostas do OSV', () => {
  it('querybatch: ids por consulta, na ordem, sem repetição; formato errado = null', () => {
    const json = { results: [{ vulns: [{ id: 'A', modified: 'x' }, { id: 'A' }, { id: 'B' }] }, {}, { vulns: [] }] };
    assert.deepEqual(lerLoteOsv(json, 3), [['A', 'B'], [], []]);
    assert.equal(lerLoteOsv(json, 2), null, 'quantidade diferente da enviada');
    assert.equal(lerLoteOsv({ erro: 'x' }, 1), null);
    assert.equal(lerLoteOsv(null, 1), null);
  });

  it('registro do Ubuntu: CVE do id, vetor CVSS_V3 e versão corrigida por ecossistema', () => {
    const v = lerVulnOsv({
      id: 'UBUNTU-CVE-2023-5678',
      summary: '  Excessive time   spent in DH check  ',
      upstream: ['CVE-2023-5678'],
      severity: [{ type: 'Ubuntu', score: 'low' }, { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L' }],
      affected: [
        { package: { name: 'openssl', ecosystem: 'Ubuntu:22.04:LTS' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '3.0.2-0ubuntu1.12' }] }] },
        { package: { name: 'openssl', ecosystem: 'Ubuntu:20.04:LTS' }, ranges: [{ type: 'GIT', events: [{ fixed: 'abc' }] }] },
      ],
    });
    assert.ok(v);
    assert.deepEqual(v.cves, ['CVE-2023-5678']);
    assert.equal(v.vetor, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L');
    assert.equal(v.resumo, 'Excessive time spent in DH check');
    assert.deepEqual(v.corrigidas, [{ ecossistema: 'Ubuntu:22.04:LTS', pacote: 'openssl', versao: '3.0.2-0ubuntu1.12' }]);
    assert.equal(v.retirada, false);
  });

  it('boletim (USN/DSA) junta vários CVEs; registro do Debian sem nota; retirado; vetor no pacote afetado', () => {
    const usn = lerVulnOsv({ id: 'USN-6450-1', upstream: ['CVE-2023-5678', 'CVE-2023-3817', 'GHSA-xxxx'], details: 'OpenSSL' });
    assert.deepEqual(usn?.cves, ['CVE-2023-5678', 'CVE-2023-3817']);
    const deb = lerVulnOsv({ id: 'DEBIAN-CVE-2023-4911', details: 'glibc', affected: [{ package: { name: 'glibc', ecosystem: 'Debian:12' } }] });
    assert.deepEqual(deb?.cves, ['CVE-2023-4911']);
    assert.equal(deb?.vetor, null);
    assert.equal(lerVulnOsv({ id: 'X-1', aliases: ['CVE-2020-1234'], withdrawn: '2024-01-01T00:00:00Z' })?.retirada, true);
    const noPacote = lerVulnOsv({ id: 'ALSA-2024:0310', upstream: ['CVE-2024-0727'], affected: [{ package: { name: 'openssl', ecosystem: 'AlmaLinux:9' }, severity: [{ type: 'CVSS_V3', score: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' }] }] });
    assert.equal(noPacote?.vetor, 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N');
    assert.equal(lerVulnOsv({ id: 'X', severity: [{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N' }] })?.vetor, null, 'só CVSS 3.x');
    assert.equal(lerVulnOsv({ semId: true }), null);
    assert.equal(lerVulnOsv('lixo'), null);
  });

  it('CWE do registro só quando é CWE válido', () => {
    assert.equal(lerVulnOsv({ id: 'GHSA-1', aliases: ['CVE-2024-1111'], database_specific: { cwe_ids: ['NVD-CWE-Other', 'CWE-79'] } })?.cwe, 'CWE-79');
    assert.equal(lerVulnOsv({ id: 'GHSA-2', database_specific: { cwe_ids: 'CWE-79' } })?.cwe, null);
  });
});

describe('leitura das respostas do NVD', () => {
  const cve = (id: string, extra: Record<string, unknown> = {}) => ({ cve: { id, descriptions: [{ lang: 'es', value: 'x' }, { lang: 'en', value: `Falha ${id}` }], ...extra } });

  it('vetor 3.1 da métrica Primary; sem 3.1, o 3.0; CWE válido das fraquezas; rejeitado sai', () => {
    const lista = lerCvesNvd({
      totalResults: 4,
      vulnerabilities: [
        cve('CVE-2024-9602', {
          metrics: {
            cvssMetricV31: [
              { source: 'chrome-cve-admin@google.com', type: 'Secondary', cvssData: { vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H' } },
              { source: 'nvd@nist.gov', type: 'Primary', cvssData: { vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' } },
            ],
          },
          weaknesses: [{ description: [{ lang: 'en', value: 'NVD-CWE-Other' }, { lang: 'en', value: 'CWE-843' }] }],
        }),
        cve('CVE-2019-0001', { metrics: { cvssMetricV30: [{ type: 'Primary', cvssData: { vectorString: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' } }] } }),
        cve('CVE-2010-0001', { metrics: { cvssMetricV2: [{ cvssData: { vectorString: 'AV:N/AC:L/Au:N/C:P/I:P/A:P' } }] } }),
        cve('CVE-2024-0002', { vulnStatus: 'Rejected' }),
        { cve: { id: 'nao-e-cve' } },
        'lixo',
      ],
    });
    assert.ok(lista);
    assert.deepEqual(lista.map((c) => [c.cve, c.vetor, c.cwe]), [
      ['CVE-2024-9602', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 'CWE-843'],
      ['CVE-2019-0001', 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', null],
      ['CVE-2010-0001', null, null],
    ]);
    assert.equal(lista[0].descricao, 'Falha CVE-2024-9602', 'descrição em inglês');
  });

  it('resposta fora do formato = null; lista vazia = nenhuma vulnerabilidade', () => {
    assert.equal(lerCvesNvd({ message: 'erro' }), null);
    assert.deepEqual(lerCvesNvd({ totalResults: 0, vulnerabilities: [] }), []);
  });
});

describe('vetor, nota e severidade do achado de estação', () => {
  it('vetorBase31: só as 8 métricas base, na ordem; 3.0 vira 3.1; inválido = null', () => {
    assert.deepEqual(vetorBase31('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L/E:U/RL:O/RC:C'), { vetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L', era30: false });
    assert.deepEqual(vetorBase31('CVSS:3.0/C:H/I:N/A:N/AV:N/AC:L/PR:N/UI:N/S:U'), { vetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', era30: true });
    assert.equal(vetorBase31('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'), null);
    assert.equal(vetorBase31('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H'), null, 'falta métrica');
    assert.equal(vetorBase31('CVSS:3.1/AV:N/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), null, 'métrica repetida');
    assert.equal(vetorBase31('AV:N/AC:L/Au:N/C:P/I:P/A:P'), null, 'CVSS 2');
    assert.equal(vetorBase31(null), null);
  });

  const base: AchadoEstacao = {
    programa: 'openssl',
    programaVersao: '3.0.2-0ubuntu1.10',
    cve: 'CVE-2023-5678',
    base: 'OSV',
    vetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L',
    cwe: null,
    resumo: 'Excessive time spent in DH check',
    registro: 'UBUNTU-CVE-2023-5678',
    origem: 'deb_packages: libssl3, openssl; OSV Ubuntu:22.04:LTS',
    corrigidaEm: '3.0.2-0ubuntu1.12',
  };

  it('a nota sai do vetor e a severidade da nota, nas quatro faixas', () => {
    const casos: [string, number, string][] = [
      ['CVSS:3.1/AV:L/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N', 2.2, 'Baixo'],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L', 5.3, 'Médio'],
      ['CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 7.5, 'Alto'],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:H', 9.8, 'Crítico'],
    ];
    for (const [vetor, nota, severidade] of casos) {
      const d = dadosAchadoEstacao({ ...base, vetor });
      assert.equal(d.cvss, nota, vetor);
      assert.equal(d.severidade, severidade, vetor);
      assert.match(d.cvssVetor, /^CVSS:3\.1\//, 'a CHECK do banco só aceita 3.1');
    }
  });

  it('achado do OSV: categoria de componente, CVE, programa, evidência e passos com a versão corrigida', () => {
    const d = dadosAchadoEstacao(base);
    assert.equal(d.categoriaOwasp, CATEGORIA_COMPONENTE);
    assert.equal(d.cve, 'CVE-2023-5678');
    assert.equal(d.programa, 'openssl');
    assert.equal(d.programaVersao, '3.0.2-0ubuntu1.10');
    assert.equal(d.baseVulnerabilidade, 'OSV');
    assert.equal(d.cwe, null);
    assert.equal(d.descricao, 'CVE-2023-5678 em openssl 3.0.2-0ubuntu1.10: Excessive time spent in DH check');
    assert.match(d.evidencia, /libssl3, openssl.*UBUNTU-CVE-2023-5678 \(OSV\)/);
    const passos = d.remediacao as unknown as { titulo: string; descricao: string }[];
    assert.match(passos[0].descricao, /3\.0\.2-0ubuntu1\.12 ou mais nova/);
    assert.match(passos[1].descricao, /osv\.dev\/vulnerability\/UBUNTU-CVE-2023-5678/);
  });

  it('achado do NVD: passos apontam o CVE; vetor 3.0 fica registrado na evidência', () => {
    const d = dadosAchadoEstacao({ ...base, base: 'NVD', programa: 'Google Chrome', programaVersao: '129.0.6668.58', cve: 'CVE-2019-0001', vetor: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', registro: 'CVE-2019-0001', cwe: 'CWE-843', corrigidaEm: null });
    assert.equal(d.cwe, 'CWE-843');
    assert.match(d.evidencia, /CVSS 3\.0; nota pela fórmula 3\.1/);
    const passos = d.remediacao as unknown as { descricao: string }[];
    assert.match(passos[1].descricao, /nvd\.nist\.gov\/vuln\/detail\/CVE-2019-0001/);
  });

  it('vetor inválido ou CVE fora do formato não vira achado (nada de nota inventada)', () => {
    assert.throws(() => dadosAchadoEstacao({ ...base, vetor: 'CVSS:4.0/AV:N' }));
    assert.throws(() => dadosAchadoEstacao({ ...base, cve: 'GHSA-1234' }));
  });

  it('validade do cache: 24 h por padrão; VULN_CACHE_HORAS dentro de 1 a 720', () => {
    const salvo = process.env.VULN_CACHE_HORAS;
    try {
      delete process.env.VULN_CACHE_HORAS;
      assert.equal(validadeCacheHoras(), 24);
      process.env.VULN_CACHE_HORAS = '6';
      assert.equal(validadeCacheHoras(), 6);
      process.env.VULN_CACHE_HORAS = '0';
      assert.equal(validadeCacheHoras(), 24);
      process.env.VULN_CACHE_HORAS = 'abc';
      assert.equal(validadeCacheHoras(), 24);
    } finally {
      if (salvo === undefined) delete process.env.VULN_CACHE_HORAS;
      else process.env.VULN_CACHE_HORAS = salvo;
    }
  });
});

describe('clientes HTTP do OSV e do NVD (servidor falso local)', () => {
  let servidor: Server;
  let url = '';
  let modo: 'normal' | 'erro' | 'mudo' | 'texto' | 'limite' = 'normal';
  const pedidos: { metodo: string; caminho: string; corpo: string; cabecalhos: IncomingMessage['headers'] }[] = [];
  const salvo = { osv: process.env.OSV_API_URL, nvd: process.env.NVD_API_URL, chave: process.env.NVD_API_KEY, t: process.env.VULN_TIMEOUT_MS };

  function tratar(req: IncomingMessage, res: ServerResponse) {
    let corpo = '';
    req.on('data', (d) => (corpo += d));
    req.on('end', () => {
      pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', corpo, cabecalhos: req.headers });
      if (modo === 'mudo') return;
      if (modo === 'erro') return res.writeHead(500).end('erro');
      if (modo === 'limite') return res.writeHead(403).end();
      if (modo === 'texto') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>');
      if (req.url?.includes('/v1/vulns/NAO-EXISTE')) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, url: req.url }));
    });
  }

  before(async () => {
    servidor = createServer(tratar);
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    process.env.OSV_API_URL = `${url}/`;
    process.env.NVD_API_URL = url;
    process.env.VULN_TIMEOUT_MS = '300';
  });
  afterEach(() => {
    modo = 'normal';
    pedidos.length = 0;
    delete process.env.NVD_API_KEY;
  });
  after(async () => {
    servidor.closeAllConnections();
    await new Promise<void>((ok) => servidor.close(() => ok()));
    for (const [k, v] of [['OSV_API_URL', salvo.osv], ['NVD_API_URL', salvo.nvd], ['NVD_API_KEY', salvo.chave], ['VULN_TIMEOUT_MS', salvo.t]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('OSV: querybatch manda pacote, ecossistema e versão; vulns/{id} codifica o id', async () => {
    await osv.consultarLote([{ nome: 'openssl', ecossistema: 'Ubuntu:22.04:LTS', versao: '3.0.2-0ubuntu1.10' }]);
    await osv.buscarVulnerabilidade('ALSA-2024:0310');
    assert.equal(pedidos[0].metodo, 'POST');
    assert.equal(pedidos[0].caminho, '/v1/querybatch');
    assert.deepEqual(JSON.parse(pedidos[0].corpo), { queries: [{ package: { name: 'openssl', ecosystem: 'Ubuntu:22.04:LTS' }, version: '3.0.2-0ubuntu1.10' }] });
    assert.equal(pedidos[1].caminho, '/v1/vulns/ALSA-2024%3A0310');
  });

  it('404 é "não existe" (null), não falha', async () => {
    assert.equal(await osv.buscarVulnerabilidade('NAO-EXISTE'), null);
  });

  it('NVD: cpeName com até 2000 por página; chave só pelo ambiente, no cabeçalho apiKey', async () => {
    await nvd.cvesPorCpe('cpe:2.3:a:google:chrome:129.0.6668.58:*:*:*:*:*:*:*');
    assert.equal(nvd.temChave(), false);
    assert.equal(pedidos[0].cabecalhos.apikey, undefined);
    const qs = new URL(pedidos[0].caminho, url).searchParams;
    assert.equal(qs.get('cpeName'), 'cpe:2.3:a:google:chrome:129.0.6668.58:*:*:*:*:*:*:*');
    assert.equal(qs.get('resultsPerPage'), '2000');
    process.env.NVD_API_KEY = 'chave-falsa-de-teste';
    await nvd.cvePorId('CVE-2024-9602');
    assert.equal(pedidos[1].cabecalhos.apikey, 'chave-falsa-de-teste');
    assert.equal(new URL(pedidos[1].caminho, url).searchParams.get('cveId'), 'CVE-2024-9602');
    assert.ok(!pedidos[1].caminho.includes('chave-falsa'), 'a chave não vai na URL');
  });

  it('erro 5xx, limite (403), corpo que não é JSON, tempo esgotado e servidor fora do ar: BaseIndisponivel', async () => {
    modo = 'erro';
    await assert.rejects(osv.consultarLote([]), (e: unknown) => e instanceof BaseIndisponivel && e.base === 'OSV' && e.status === 500);
    modo = 'limite';
    await assert.rejects(nvd.cvePorId('CVE-2024-9602'), (e: unknown) => e instanceof BaseIndisponivel && e.base === 'NVD' && e.status === 403);
    modo = 'texto';
    await assert.rejects(osv.buscarVulnerabilidade('X'), BaseIndisponivel);
    modo = 'mudo';
    const inicio = Date.now();
    await assert.rejects(osv.buscarVulnerabilidade('X'), (e: unknown) => e instanceof BaseIndisponivel && /tempo esgotado/.test(e.message));
    assert.ok(Date.now() - inicio < 5000);
    await assert.rejects(obterJson('NVD', 'http://127.0.0.1:9/fora'), BaseIndisponivel);
  });

  it('tempo limite padrão de 15 s; VULN_TIMEOUT_MS muda', () => {
    assert.equal(tempoLimiteMs(), 300);
    process.env.VULN_TIMEOUT_MS = 'x';
    assert.equal(tempoLimiteMs(), 15_000);
    process.env.VULN_TIMEOUT_MS = '300';
  });
});
