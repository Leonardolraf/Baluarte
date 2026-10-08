// OSV e NVD SIMULADOS para a validacao do agente (B08, scripts/validar-agente-docker.sh).
// A API da validacao aponta OSV_API_URL e NVD_API_URL para ca e roda numa rede Docker sem
// saida para a internet: nenhuma consulta chega as bases reais. A unica "vulnerabilidade" e
// ficticia (CVE-2099-0001, ano impossivel) e afeta o pacote-fonte glibc (libc6) no Ubuntu,
// que existe em toda estacao Ubuntu: serve so para provar o caminho inventario -> achado.
// GET /_pedidos devolve o que foi recebido (a conferencia mostra isso no fim).
import { createServer } from 'node:http';

const PORTA = Number(process.env.PORTA ?? 8090);
const ID = 'BALUARTE-SIMULADO-0001';
const PACOTE = 'glibc';
const pedidos = { osvLote: 0, osvRegistro: 0, nvd: 0, pacotesConsultados: 0, ecossistemas: [] };

function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(corpo));
}

function registro() {
  return {
    id: ID,
    summary: 'Vulnerabilidade SIMULADA pela validacao do agente do Baluarte (nao existe)',
    upstream: ['CVE-2099-0001'],
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H' }],
    affected: pedidos.ecossistemas.map((ecosystem) => ({
      package: { name: PACOTE, ecosystem },
      ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '99.0-0simulado1' }] }],
    })),
  };
}

createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => (corpo += d));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://simulado');
    if (url.pathname === '/_pedidos') return json(res, 200, pedidos);
    if (url.pathname.startsWith('/nvd/')) {
      pedidos.nvd += 1;
      return json(res, 200, { totalResults: 0, vulnerabilities: [] });
    }
    if (url.pathname === '/osv/v1/querybatch' && req.method === 'POST') {
      pedidos.osvLote += 1;
      let queries = [];
      try {
        queries = JSON.parse(corpo).queries ?? [];
      } catch {
        return json(res, 400, { message: 'corpo invalido' });
      }
      pedidos.pacotesConsultados += queries.length;
      return json(res, 200, {
        results: queries.map((q) => {
          const eco = q?.package?.ecosystem ?? '';
          if (q?.package?.name !== PACOTE || !eco.startsWith('Ubuntu:')) return {};
          if (!pedidos.ecossistemas.includes(eco)) pedidos.ecossistemas.push(eco);
          return { vulns: [{ id: ID, modified: '2026-10-08T00:00:00Z' }] };
        }),
      });
    }
    if (url.pathname === `/osv/v1/vulns/${ID}`) {
      pedidos.osvRegistro += 1;
      return json(res, 200, registro());
    }
    pedidos.osvRegistro += url.pathname.startsWith('/osv/v1/vulns/') ? 1 : 0;
    return json(res, 404, { code: 5, message: 'Bug not found.' });
  });
}).listen(PORTA, () => console.log(`[bases-simuladas] OSV/NVD simulados em :${PORTA}`));
