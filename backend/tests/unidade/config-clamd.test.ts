// Testes de UNIDADE da configuracao do clamd versionada no docker-compose.yml (Melhorias #18).
// As regras foram medidas no ClamAV 1.5.4 (README, "Arquivos de ate 250 MB"); este teste so
// impede que alguem mude um numero no compose e quebre a relacao entre eles sem perceber:
//   - o fluxo aceita o limite da API (StreamMaxLength >= LIMITE_ARQUIVO_BYTES);
//   - so a cota corta, e ela avisa: AlertExceedsMax ligado, e os limites que cortam em silencio
//     (MaxFileSize, MaxHTMLNormalize, MaxScriptNormalize, PCREMaxFileSize) acima do MaxScanSize;
//   - quem responde no limite de tempo e o clamd, com o alerta: MaxScanTime abaixo do tempo
//     limite do cliente na API (CLAMAV_TIMEOUT_MS);
//   - a busca por Zip64 da API (DT27) descomprime ate a mesma cota do clamd (MaxScanSize).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIMITE_ARQUIVO_BYTES, LIMITE_DESCOMPRESSAO_ZIP64_BYTES } from '../../src/models/analiseArquivo.model.js';
import { TEMPO_LIMITE_PADRAO_MS } from '../../src/config/antivirus.js';

const COMPOSE = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url));

/** CLAMD_CONF_<Opcao>=<valor> do servico clamav. */
function configuracao(): Record<string, string> {
  const texto = readFileSync(COMPOSE, 'utf8');
  const conf: Record<string, string> = {};
  for (const m of texto.matchAll(/^\s*-\s*CLAMD_CONF_(\w+)=(\S+)\s*$/gm)) conf[m[1]] = m[2];
  return conf;
}

/** Tamanho no formato do clamd.conf ("251M", "1000M", "40K", bytes) em bytes. */
function bytes(valor: string): number {
  const m = /^(\d+)([KkMm]?)$/.exec(valor);
  assert.ok(m, `tamanho inválido no compose: ${valor}`);
  const fator = { '': 1, k: 1024, m: 1024 * 1024 }[m[2].toLowerCase() as '' | 'k' | 'm'];
  return Number(m[1]) * fator;
}

describe('configuração do clamd no docker-compose.yml', () => {
  const conf = configuracao();

  it('o fluxo aceita o arquivo inteiro do limite da API', () => {
    assert.ok(conf.StreamMaxLength, 'StreamMaxLength definido');
    assert.ok(bytes(conf.StreamMaxLength) > LIMITE_ARQUIVO_BYTES, `StreamMaxLength ${conf.StreamMaxLength} > 250 MB`);
  });

  it('só a cota corta, e ela avisa: AlertExceedsMax ligado e os limites silenciosos acima do MaxScanSize', () => {
    assert.equal(conf.AlertExceedsMax, 'yes');
    const cota = bytes(conf.MaxScanSize);
    assert.ok(cota >= LIMITE_ARQUIVO_BYTES, 'a cota cobre ao menos o arquivo enviado');
    for (const silencioso of ['MaxFileSize', 'MaxHTMLNormalize', 'MaxScriptNormalize', 'PCREMaxFileSize']) {
      assert.ok(conf[silencioso], `${silencioso} definido (o padrão da imagem corta em silêncio)`);
      assert.ok(bytes(conf[silencioso]) > cota, `${silencioso} (${conf[silencioso]}) acima do MaxScanSize (${conf.MaxScanSize})`);
    }
  });

  it('o limite de tempo do clamd vem antes do tempo limite da API, e é explícito', () => {
    assert.ok(conf.MaxScanTime, 'MaxScanTime definido (o padrão implícito é 120 s)');
    const ms = Number(conf.MaxScanTime);
    assert.ok(ms > 0, 'MaxScanTime ligado (0 desliga o limite)');
    assert.ok(ms < TEMPO_LIMITE_PADRAO_MS, `MaxScanTime ${ms} ms < CLAMAV_TIMEOUT_MS padrão ${TEMPO_LIMITE_PADRAO_MS} ms`);
  });

  it('a busca por Zip64 da API (DT27) descomprime até a cota do clamd, nem mais nem menos', () => {
    assert.equal(LIMITE_DESCOMPRESSAO_ZIP64_BYTES, bytes(conf.MaxScanSize));
  });
});
