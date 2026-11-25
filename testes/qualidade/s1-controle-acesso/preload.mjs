// Instrumentacao da metrica S1 (Plano de Qualidade v2): registra cada resposta servida pela API
// durante os testes (rota casada, metodo, status, codigoErro, se havia token). Fica fora do
// repositorio e nao altera src/: envolve express.response.json (o prototipo de onde o
// app.response herda) e express.application.handle, antes de o app ser criado.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(process.env.S1_BACKEND + '/package.json');
const express = require('express');
const destino = join(process.env.S1_SAIDA, `${process.pid}.jsonl`);

const jsonOriginal = express.response.json;
express.response.json = function (corpo) {
  if (corpo && typeof corpo === 'object' && 'codigoErro' in corpo) this.locals.__s1Codigo = corpo.codigoErro;
  return jsonOriginal.call(this, corpo);
};

const handleOriginal = express.application.handle;
express.application.handle = function (req, res, cb) {
  res.on('finish', () => {
    try {
      if (!req.route) return;
      const linha = {
        m: req.method,
        r: (req.baseUrl || '') + req.route.path,
        s: res.statusCode,
        c: res.locals?.__s1Codigo ?? null,
        t: Boolean(req.headers.authorization),
      };
      appendFileSync(destino, JSON.stringify(linha) + '\n');
    } catch {
      // a medicao nunca derruba o teste
    }
  });
  return handleOriginal.call(this, req, res, cb);
};
