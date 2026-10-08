// OSV e NVD FALSOS para a suíte E2E em modo real (B15). A API de teste recebe
// OSV_API_URL=<este servidor>/osv e NVD_API_URL=<este servidor>/nvd, então o botão
// "Verificar vulnerabilidades" (B14) nunca consulta as bases públicas de verdade.
//
// Respostas (só o que o cruzamento lê; formato igual ao de backend/tests/cruzamento.test.ts):
//  - querybatch do OSV: pacote `openssl` ou `curl` de ecossistema Ubuntu, em qualquer versão,
//    tem uma vulnerabilidade conhecida (CVE com vetor CVSS 3.1); o resto, nenhuma. Qualquer
//    versão vale para cada teste poder usar uma versão única e não cair no cache do banco.
//  - pacote `e2e-base-fora-do-ar` no lote: o OSV responde 503 (base fora do ar).
//  - NVD: nenhuma vulnerabilidade (a suíte não usa estação Windows).
//  - GET /__pedidos: quantas consultas cada base recebeu (o teste confere que passou por aqui).
import { createServer } from 'node:http';

const VULNS = {
  'UBUNTU-CVE-2023-5678': {
    id: 'UBUNTU-CVE-2023-5678',
    summary: 'Excessive time spent in DH check',
    upstream: ['CVE-2023-5678'],
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L' }],
    affected: [{ package: { name: 'openssl', ecosystem: 'Ubuntu:22.04:LTS' } }],
  },
  'UBUNTU-CVE-2023-38545': {
    id: 'UBUNTU-CVE-2023-38545',
    summary: 'SOCKS5 heap buffer overflow',
    upstream: ['CVE-2023-38545'],
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
    affected: [{ package: { name: 'curl', ecosystem: 'Ubuntu:22.04:LTS' } }],
  },
};
const POR_PACOTE = { openssl: 'UBUNTU-CVE-2023-5678', curl: 'UBUNTU-CVE-2023-38545' };
export const PACOTE_FORA_DO_AR = 'e2e-base-fora-do-ar';

function json(res, status, corpo) {
  res
    .writeHead(status, { 'content-type': 'application/json' })
    .end(corpo === undefined ? '' : JSON.stringify(corpo));
}

/** Sobe o servidor em 127.0.0.1:<porta> e devolve uma função que o derruba. */
export function iniciarBasesFalsas(porta) {
  const pedidos = { OSV: 0, NVD: 0 };
  const servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => (corpo += d));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://falso');
      if (url.pathname === '/__pedidos') return json(res, 200, pedidos);
      if (url.pathname.startsWith('/nvd')) {
        pedidos.NVD += 1;
        return json(res, 200, { totalResults: 0, vulnerabilities: [] });
      }
      if (!url.pathname.startsWith('/osv')) return json(res, 404, {});
      pedidos.OSV += 1;
      if (url.pathname === '/osv/v1/querybatch') {
        let queries = [];
        try {
          queries = JSON.parse(corpo).queries ?? [];
        } catch {
          return json(res, 400, { message: 'corpo inválido' });
        }
        if (queries.some((q) => q.package?.name === PACOTE_FORA_DO_AR))
          return json(res, 503, { message: 'fora do ar' });
        return json(res, 200, {
          results: queries.map((q) => {
            const id = String(q.package?.ecosystem ?? '').startsWith('Ubuntu')
              ? POR_PACOTE[q.package?.name]
              : undefined;
            return id ? { vulns: [{ id, modified: '2024-01-01T00:00:00Z' }] } : {};
          }),
        });
      }
      const id = decodeURIComponent(url.pathname.replace('/osv/v1/vulns/', ''));
      return id in VULNS ? json(res, 200, VULNS[id]) : json(res, 404, { code: 5, message: 'Bug not found.' });
    });
  });
  return new Promise((ok, falha) => {
    servidor.once('error', falha);
    servidor.listen(porta, '127.0.0.1', () =>
      ok(
        () =>
          new Promise((fim) => {
            servidor.closeAllConnections();
            servidor.close(() => fim());
          }),
      ),
    );
  });
}
