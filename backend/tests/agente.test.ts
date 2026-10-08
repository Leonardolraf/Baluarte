// B07 — lado servidor do protocolo remoto TLS do osquery (plugin "tls"). Simula o osquery
// com fetch e os mesmos corpos JSON que ele manda (enroll, config, logger), sem TLS (o TLS
// fica na frente da API). Banco Postgres isolado (baluarte_test_agente) — ver helpers.ts.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { ANALISTA, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, urlBase } from './helpers.js';

prepararBanco(import.meta.url);

const SEGREDO = randomBytes(24).toString('hex');
process.env.OSQUERY_ENROLL_SECRET = SEGREDO;
delete process.env.OSQUERY_INTERVALO_S;

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { segredoConfere } = await import('../src/services/agente.service.js');

const ENROLL = '/agentes/osquery/enroll';
const CONFIG = '/agentes/osquery/config';
const LOGGER = '/agentes/osquery/logger';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
let seq = 0;

before(() => iniciarServidor(app));
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});
beforeEach(() => {
  process.env.OSQUERY_ENROLL_SECRET = SEGREDO;
  delete process.env.OSQUERY_INTERVALO_S;
});

/** host_details como o osquery 5 manda na inscricao (todas as colunas como texto). */
function detalhes(hostname: string, so = { name: 'Ubuntu', version: '22.04.4 LTS (Jammy Jellyfish)', platform: 'ubuntu', build: '' }) {
  return {
    os_version: { _id: '1', codename: 'jammy', major: '22', minor: '4', patch: '0', platform_like: 'debian', ...so },
    osquery_info: { version: '5.12.1', build_platform: 'ubuntu', config_valid: '0', extensions: 'active', pid: '1234' },
    system_info: { hostname, computer_name: hostname.split('.')[0], cpu_brand: 'Intel', hardware_vendor: 'Dell', uuid: 'abc' },
    platform_info: { vendor: 'Dell', version: '1.2.3' },
  };
}

function hostIdUnico(): string {
  seq += 1;
  return `4c4c4544-0042-${String(seq).padStart(4, '0')}-8052-b4c04f4d3${String(seq).padStart(3, '0')}`;
}

async function inscrever(hostIdentifier = hostIdUnico(), hostname = `estacao-${++seq}.empresa.local`) {
  const r = await chamar('POST', ENROLL, {
    body: { enroll_secret: SEGREDO, host_identifier: hostIdentifier, platform_type: '9', host_details: detalhes(hostname) },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { nodeKey: r.body.node_key as string, hostIdentifier, hostname, corpo: r.body };
}

/** Evento de resultado como o osquery manda para uma query agendada com snapshot: true. */
function snapshot(nome: string, hostIdentifier: string, linhas: Record<string, string>[]) {
  return {
    snapshot: linhas,
    action: 'snapshot',
    name: nome,
    hostIdentifier,
    calendarTime: 'Thu Oct  8 12:00:00 2026 UTC',
    unixTime: 1791460800,
    epoch: 0,
    counter: 0,
    numerics: false,
    decorations: { host_uuid: hostIdentifier },
  };
}

describe('inscrição (enroll)', () => {
  it('segredo certo: devolve node_key e cria a estação como ativo "Estação de trabalho"', async () => {
    const { nodeKey, hostIdentifier, hostname, corpo } = await inscrever();
    assert.match(nodeKey, /^[0-9a-f]{64}$/);
    assert.equal(corpo.node_invalid, false);
    const estacao = await prisma.workstation.findUnique({ where: { hostIdentifier }, include: { asset: true } });
    assert.ok(estacao);
    assert.equal(estacao.asset.tipo, 'Estação de trabalho');
    assert.equal(estacao.asset.host, hostname);
    assert.equal(estacao.asset.nome, hostname.split('.')[0]);
    assert.equal(estacao.sistema, 'Ubuntu 22.04.4 LTS (Jammy Jellyfish)');
    assert.equal(estacao.soPlataforma, 'ubuntu');
  });

  it('a chave fica só como hash SHA-256 no banco, nunca em texto puro', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
    assert.equal(estacao.nodeKeyHash, sha256(nodeKey));
    const tabelas = await prisma.$queryRawUnsafe<{ achou: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM "Workstation" w WHERE w::text LIKE $1)
           OR EXISTS (SELECT 1 FROM "Asset" a WHERE a::text LIKE $1)
           OR EXISTS (SELECT 1 FROM "AuditLog" l WHERE l::text LIKE $1) AS achou`,
      `%${nodeKey}%`,
    );
    assert.equal(tabelas[0].achou, false, 'a chave em claro não pode aparecer em nenhuma linha');
  });

  it('registra a inscrição na auditoria com o host_identifier', async () => {
    const { hostIdentifier } = await inscrever();
    const reg = await prisma.auditLog.findFirst({ where: { acao: 'INSCREVER_ESTACAO', detalhe: { contains: hostIdentifier } } });
    assert.ok(reg, 'esperava o registro INSCREVER_ESTACAO');
    assert.equal(reg.usuarioId, null);
  });

  it('segredo errado: 401 node_invalid, sem criar estação', async () => {
    const hostIdentifier = hostIdUnico();
    const r = await chamar('POST', ENROLL, { body: { enroll_secret: `${SEGREDO}x`, host_identifier: hostIdentifier, host_details: {} } });
    esperaErro(r, 401, 'SEGREDO_INVALIDO');
    assert.equal(r.body.node_invalid, true);
    assert.equal(r.body.node_key, undefined);
    assert.equal(await prisma.workstation.count({ where: { hostIdentifier } }), 0);
  });

  it('segredo ausente: 401 node_invalid', async () => {
    const r = await chamar('POST', ENROLL, { body: { host_identifier: hostIdUnico(), host_details: {} } });
    esperaErro(r, 401, 'SEGREDO_INVALIDO');
    assert.equal(r.body.node_invalid, true);
  });

  it('sem OSQUERY_ENROLL_SECRET (ou curto demais) a inscrição fica desligada: 503', async () => {
    delete process.env.OSQUERY_ENROLL_SECRET;
    let r = await chamar('POST', ENROLL, { body: { enroll_secret: SEGREDO, host_identifier: hostIdUnico() } });
    esperaErro(r, 503, 'INSCRICAO_DESLIGADA');
    assert.equal(r.body.node_invalid, true);
    process.env.OSQUERY_ENROLL_SECRET = 'curto';
    r = await chamar('POST', ENROLL, { body: { enroll_secret: 'curto', host_identifier: hostIdUnico() } });
    esperaErro(r, 503, 'INSCRICAO_DESLIGADA');
  });

  it('host_identifier ausente ou inválido: 400', async () => {
    esperaErro(await chamar('POST', ENROLL, { body: { enroll_secret: SEGREDO } }), 400, 'HOST_IDENTIFIER_INVALIDO');
    esperaErro(await chamar('POST', ENROLL, { body: { enroll_secret: SEGREDO, host_identifier: '   ' } }), 400, 'HOST_IDENTIFIER_INVALIDO');
    esperaErro(await chamar('POST', ENROLL, { body: { enroll_secret: SEGREDO, host_identifier: 'x'.repeat(256) } }), 400, 'HOST_IDENTIFIER_INVALIDO');
    esperaErro(await chamar('POST', ENROLL, { body: { enroll_secret: 123, host_identifier: 'a' } }), 400, 'SEGREDO_INVALIDO');
  });

  it('reinscrição da mesma estação troca a chave e não duplica o ativo', async () => {
    const primeira = await inscrever();
    const segunda = await inscrever(primeira.hostIdentifier, primeira.hostname);
    assert.notEqual(segunda.nodeKey, primeira.nodeKey);
    assert.equal(await prisma.workstation.count({ where: { hostIdentifier: primeira.hostIdentifier } }), 1);
    assert.equal(await prisma.asset.count({ where: { host: primeira.hostname } }), 1);
    const velha = await chamar('POST', CONFIG, { body: { node_key: primeira.nodeKey } });
    assert.deepEqual(velha.body, { node_invalid: true }, 'a chave anterior deixa de valer');
    const nova = await chamar('POST', CONFIG, { body: { node_key: segunda.nodeKey } });
    assert.equal(nova.body.node_invalid, false);
  });

  it('hostname já cadastrado como ativo: a estação ganha host próprio, sem colidir', async () => {
    const analista = await login(ANALISTA.email, ANALISTA.senha);
    const host = `colide-${++seq}.empresa.local`;
    const cad = await chamar('POST', '/assets', { token: analista, body: { nome: 'Servidor', tipo: 'Servidor', host } });
    assert.equal(cad.status, 201);
    const { hostIdentifier } = await inscrever(hostIdUnico(), host);
    const estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier }, include: { asset: true } });
    assert.notEqual(estacao.asset.host, host);
    assert.ok(estacao.asset.host.startsWith(`${host}-`));
  });

  it('B08: NUL que o osquery manda nos valores (cpu_brand no Linux) é removido, não recusa a inscrição', async () => {
    // Corpo real do osquery 5.23.1 num Ubuntu 24.04 (validação em contêiner): o cpu_brand vem
    // com o terminador de string C. Antes, a regra geral de NUL devolvia 400 e o agente nunca
    // se inscrevia.
    const hostIdentifier = hostIdUnico();
    const d = detalhes('estacao-nul.empresa.local', { name: 'Ubuntu\u0000', version: '24.04.5 LTS (Noble Numbat)', platform: 'ubuntu', build: '' });
    const r = await chamar('POST', ENROLL, {
      body: {
        enroll_secret: SEGREDO,
        host_identifier: hostIdentifier,
        host_details: { ...d, system_info: { ...d.system_info, cpu_brand: 'AMD Ryzen 7 5700X 8-Core Processor             \u0000' } },
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
    assert.equal(estacao.soNome, 'Ubuntu');
    // O mesmo vale para os resultados do logger.
    const l = await chamar('POST', LOGGER, {
      body: { node_key: r.body.node_key, log_type: 'result', data: [snapshot('baluarte_programas_deb', hostIdentifier, [{ name: 'libfoo\u0000', version: '1.0\u0000' }])] },
    });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const programas = await prisma.workstationSoftware.findMany({ where: { workstationId: estacao.id } });
    assert.deepEqual(programas.map((p) => [p.nome, p.versao]), [['libfoo', '1.0']]);
  });

  it('B08: chave com NUL continua barrada nas rotas do agente, e as demais rotas seguem recusando NUL', async () => {
    const r = await chamar('POST', ENROLL, { body: { enroll_secret: SEGREDO, host_identifier: hostIdUnico(), 'x\u0000': '1' } });
    esperaErro(r, 400, 'CARACTERE_INVALIDO');
    const login = await chamar('POST', '/login', { body: { email: 'a\u0000@empresa.com', senha: 'x' } });
    esperaErro(login, 400, 'CARACTERE_INVALIDO');
  });

  it('aceita o corpo sem Content-Type JSON (o servidor não depende do cabeçalho)', async () => {
    const res = await fetch(urlBase() + ENROLL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ enroll_secret: SEGREDO, host_identifier: hostIdUnico(), host_details: {} }),
    });
    assert.equal(res.status, 200);
    const corpo = (await res.json()) as { node_key: string };
    assert.match(corpo.node_key, /^[0-9a-f]{64}$/);
  });

  it('compara o segredo em tempo constante sem depender do tamanho', () => {
    assert.equal(segredoConfere(SEGREDO, SEGREDO), true);
    assert.equal(segredoConfere('', SEGREDO), false);
    assert.equal(segredoConfere(`${SEGREDO}a`, SEGREDO), false);
  });
});

describe('configuração (config)', () => {
  it('chave válida: devolve o schedule do inventário e atualiza o visto-por-último', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    await prisma.workstation.update({ where: { hostIdentifier }, data: { vistaEm: new Date('2026-01-01T00:00:00Z') } });
    const r = await chamar('POST', CONFIG, { body: { node_key: nodeKey } });
    assert.equal(r.status, 200);
    assert.equal(r.body.node_invalid, false);
    const s = r.body.schedule;
    assert.deepEqual(Object.keys(s).sort(), [
      'baluarte_portas',
      'baluarte_programas_deb',
      'baluarte_programas_macos',
      'baluarte_programas_rpm',
      'baluarte_programas_windows',
      'baluarte_sistema',
    ]);
    assert.match(s.baluarte_programas_windows.query, /FROM programs/);
    assert.equal(s.baluarte_programas_windows.platform, 'windows');
    assert.match(s.baluarte_programas_deb.query, /FROM deb_packages/);
    assert.match(s.baluarte_programas_rpm.query, /FROM rpm_packages/);
    assert.equal(s.baluarte_programas_macos.platform, 'darwin');
    assert.match(s.baluarte_sistema.query, /FROM os_version/);
    assert.match(s.baluarte_portas.query, /listening_ports.*processes/);
    for (const q of Object.values(s) as { snapshot: boolean }[]) assert.equal(q.snapshot, true);
    // B08: fora de produção o base é 5 min; portas a 1/4 dele, SO a 6x.
    assert.equal(s.baluarte_programas_windows.interval, 300);
    assert.equal(s.baluarte_programas_deb.interval, 300);
    assert.equal(s.baluarte_portas.interval, 75);
    assert.equal(s.baluarte_sistema.interval, 1800);
    assert.equal(r.body.options.schedule_splay_percent, 10);
    const estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
    assert.ok(estacao.vistaEm.getTime() > Date.now() - 60_000);
  });

  it('OSQUERY_INTERVALO_S muda o intervalo; valor fora da faixa cai no padrão', async () => {
    const { nodeKey } = await inscrever();
    process.env.OSQUERY_INTERVALO_S = '3600';
    let r = await chamar('POST', CONFIG, { body: { node_key: nodeKey } });
    assert.equal(r.body.schedule.baluarte_programas_windows.interval, 3600);
    process.env.OSQUERY_INTERVALO_S = '5';
    r = await chamar('POST', CONFIG, { body: { node_key: nodeKey } });
    assert.equal(r.body.schedule.baluarte_programas_windows.interval, 300);
  });

  it('B08: em produção, programas a cada 1 h, portas a cada 15 min e SO a cada 6 h, com splay', async () => {
    const { nodeKey } = await inscrever();
    const anterior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const r = await chamar('POST', CONFIG, { body: { node_key: nodeKey } });
      const s = r.body.schedule;
      for (const nome of ['baluarte_programas_windows', 'baluarte_programas_deb', 'baluarte_programas_rpm', 'baluarte_programas_macos'])
        assert.equal(s[nome].interval, 3600, nome);
      assert.equal(s.baluarte_portas.interval, 900);
      assert.equal(s.baluarte_sistema.interval, 21600);
      assert.equal(r.body.options.schedule_splay_percent, 10);
    } finally {
      process.env.NODE_ENV = anterior;
    }
  });

  it('B08: cada categoria fica entre 60 s e 1 dia, qualquer que seja o base', async () => {
    const { nodeKey } = await inscrever();
    process.env.OSQUERY_INTERVALO_S = '60';
    let s = (await chamar('POST', CONFIG, { body: { node_key: nodeKey } })).body.schedule;
    assert.deepEqual([s.baluarte_portas.interval, s.baluarte_programas_deb.interval, s.baluarte_sistema.interval], [60, 60, 360]);
    process.env.OSQUERY_INTERVALO_S = '86400';
    s = (await chamar('POST', CONFIG, { body: { node_key: nodeKey } })).body.schedule;
    assert.deepEqual([s.baluarte_portas.interval, s.baluarte_programas_deb.interval, s.baluarte_sistema.interval], [21600, 86400, 86400]);
  });

  it('chave desconhecida: 200 { node_invalid: true } (o osquery se reinscreve)', async () => {
    const r = await chamar('POST', CONFIG, { body: { node_key: randomBytes(32).toString('hex') } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { node_invalid: true });
  });

  it('chave fora do formato ou ausente: 400 com node_invalid', async () => {
    for (const body of [{}, { node_key: '' }, { node_key: 'abc' }, { node_key: { $ne: null } }]) {
      const r = await chamar('POST', CONFIG, { body });
      esperaErro(r, 400, 'NODE_KEY_INVALIDA');
      assert.equal(r.body.node_invalid, true);
    }
  });
});

describe('recebimento de resultados (logger)', () => {
  it('guarda programas, SO e portas e atualiza o visto-por-último', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const data = [
      snapshot('baluarte_programas_windows', hostIdentifier, [
        { name: 'Google Chrome', version: '129.0.6668.90', fornecedor: 'Google LLC' },
        { name: '7-Zip 23.01 (x64)', version: '23.01', fornecedor: 'Igor Pavlov' },
        { name: '7-Zip 23.01 (x64)', version: '23.01', fornecedor: 'Igor Pavlov' },
        { name: 'Sem versão', version: '', fornecedor: '' },
      ]),
      snapshot('baluarte_programas_deb', hostIdentifier, [{ name: 'openssl', version: '3.0.2-0ubuntu1.18', fornecedor: 'Ubuntu Developers' }]),
      snapshot('baluarte_sistema', hostIdentifier, [
        { name: 'Microsoft Windows 11 Pro', version: '10.0.22631', build: '22631', platform: 'windows' },
      ]),
      snapshot('baluarte_portas', hostIdentifier, [
        { port: '3389', protocol: '6', address: '0.0.0.0', processo: 'svchost.exe' },
        { port: '3389', protocol: '6', address: '0.0.0.0', processo: 'svchost.exe' },
        { port: '137', protocol: '17', address: '192.168.0.10', processo: 'System' },
        { port: '0', protocol: '6', address: '0.0.0.0', processo: 'x' },
        { port: '9', protocol: '58', address: '::', processo: 'x' },
      ]),
    ];
    const r = await chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'result', data } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {});

    const estacao = await prisma.workstation.findUniqueOrThrow({
      where: { hostIdentifier },
      include: { programas: { orderBy: { nome: 'asc' } }, portas: { orderBy: { porta: 'asc' } } },
    });
    assert.deepEqual(
      estacao.programas.map((p) => [p.nome, p.versao, p.fonte, p.fornecedor]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
      [
        ['7-Zip 23.01 (x64)', '23.01', 'programs', 'Igor Pavlov'],
        ['Google Chrome', '129.0.6668.90', 'programs', 'Google LLC'],
        ['Sem versão', '', 'programs', null],
        ['openssl', '3.0.2-0ubuntu1.18', 'deb_packages', 'Ubuntu Developers'],
      ],
    );
    assert.deepEqual(
      estacao.portas.map((p) => [p.porta, p.protocolo, p.endereco, p.processo]),
      [
        [137, 'UDP', '192.168.0.10', 'System'],
        [3389, 'TCP', '0.0.0.0', 'svchost.exe'],
      ],
    );
    assert.equal(estacao.sistema, 'Microsoft Windows 11 Pro 10.0.22631');
    assert.equal(estacao.soVersao, '10.0.22631');
    assert.equal(estacao.soBuild, '22631');
    assert.equal(estacao.soPlataforma, 'windows');
    assert.ok(estacao.inventarioEm && estacao.inventarioEm.getTime() > Date.now() - 60_000);
    assert.ok(estacao.vistaEm.getTime() > Date.now() - 60_000);
  });

  it('o snapshot novo substitui o anterior da mesma fonte e não mexe nas outras', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const enviar = (data: unknown[]) => chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'result', data } });
    await enviar([
      snapshot('baluarte_programas_rpm', hostIdentifier, [{ name: 'bash', version: '5.1.8-9.el9', fornecedor: 'Red Hat' }]),
      snapshot('baluarte_programas_deb', hostIdentifier, [{ name: 'curl', version: '7.81.0-1', fornecedor: 'Ubuntu' }]),
    ]);
    await enviar([snapshot('baluarte_programas_rpm', hostIdentifier, [{ name: 'bash', version: '5.1.8-10.el9', fornecedor: 'Red Hat' }])]);
    const programas = await prisma.workstationSoftware.findMany({ where: { workstation: { hostIdentifier } }, orderBy: { nome: 'asc' } });
    assert.deepEqual(
      programas.map((p) => [p.nome, p.versao, p.fonte]),
      [
        ['bash', '5.1.8-10.el9', 'rpm_packages'],
        ['curl', '7.81.0-1', 'deb_packages'],
      ],
    );
  });

  it('B08: o mesmo inventário enviado a cada ciclo não duplica programas, portas nem a estação', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const data = [
      snapshot('baluarte_programas_deb', hostIdentifier, [
        { name: 'libc6', version: '2.39-0ubuntu8.4', fornecedor: 'Ubuntu Developers', origem: 'glibc' },
        { name: 'bash', version: '5.2.21-2ubuntu4', fornecedor: 'Ubuntu Developers', origem: 'bash' },
      ]),
      snapshot('baluarte_portas', hostIdentifier, [{ port: '22', protocol: '6', address: '0.0.0.0', processo: 'sshd' }]),
      snapshot('baluarte_sistema', hostIdentifier, [{ name: 'Ubuntu', version: '24.04.3 LTS (Noble Numbat)', build: '', platform: 'ubuntu' }]),
    ];
    const enviar = () => chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'result', data } });
    for (let ciclo = 0; ciclo < 3; ciclo++) assert.equal((await enviar()).status, 200);
    // O osquery também se reinscreve com a mesma identidade quando perde a chave.
    const nova = await chamar('POST', ENROLL, {
      body: { enroll_secret: SEGREDO, host_identifier: hostIdentifier, host_details: detalhes('outra.empresa.local') },
    });
    assert.equal(nova.status, 200);
    await chamar('POST', LOGGER, { body: { node_key: nova.body.node_key, log_type: 'result', data } });

    assert.equal(await prisma.workstation.count({ where: { hostIdentifier } }), 1);
    const estacao = await prisma.workstation.findUniqueOrThrow({
      where: { hostIdentifier },
      include: { programas: { orderBy: { nome: 'asc' } }, portas: true },
    });
    assert.deepEqual(
      estacao.programas.map((p) => [p.nome, p.versao, p.pacoteOrigem]),
      [
        ['bash', '5.2.21-2ubuntu4', null],
        ['libc6', '2.39-0ubuntu8.4', 'glibc'],
      ],
    );
    assert.deepEqual(estacao.portas.map((p) => [p.porta, p.protocolo, p.processo]), [[22, 'TCP', 'sshd']]);
    assert.equal(estacao.sistema, 'Ubuntu 24.04.3 LTS (Noble Numbat)');
    assert.equal(await prisma.asset.count({ where: { id: estacao.assetId } }), 1);
  });

  it('B14: deb guarda o pacote-fonte; linha sem a coluna nova (configuração antiga) continua aceita', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const r = await chamar('POST', LOGGER, {
      body: {
        node_key: nodeKey,
        log_type: 'result',
        data: [
          snapshot('baluarte_programas_deb', hostIdentifier, [
            { name: 'libssl3', version: '3.0.2-0ubuntu1.18', fornecedor: 'Ubuntu Developers', origem: 'openssl' },
            { name: 'openssl', version: '3.0.2-0ubuntu1.18', fornecedor: 'Ubuntu Developers', origem: 'openssl' },
            { name: 'gcc-12-base', version: '12.3.0-1ubuntu1~22.04', fornecedor: 'Ubuntu', origem: 'gcc-12 (12.3.0-1ubuntu1~22.04)' },
            { name: 'curl', version: '7.81.0-1ubuntu1.18', fornecedor: 'Ubuntu' },
          ]),
        ],
      },
    });
    assert.deepEqual(r.body, {});
    const programas = await prisma.workstationSoftware.findMany({ where: { workstation: { hostIdentifier } }, orderBy: { nome: 'asc' } });
    assert.deepEqual(
      programas.map((p) => [p.nome, p.pacoteOrigem]),
      [
        ['curl', null],
        ['gcc-12-base', 'gcc-12 (12.3.0-1ubuntu1~22.04)'],
        ['libssl3', 'openssl'],
        ['openssl', null],
      ],
    );
  });

  it('B14: a configuração pede o pacote-fonte do deb e a epoch do rpm', async () => {
    const { nodeKey } = await inscrever();
    const s = (await chamar('POST', CONFIG, { body: { node_key: nodeKey } })).body.schedule;
    assert.match(s.baluarte_programas_deb.query, /source AS origem/);
    assert.match(s.baluarte_programas_rpm.query, /epoch \|\| ':'/);
  });

  it('log de status e eventos desconhecidos só atualizam o visto-por-último', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const antes = new Date('2026-01-01T00:00:00Z');
    await prisma.workstation.update({ where: { hostIdentifier }, data: { vistaEm: antes } });
    const status = [{ hostIdentifier, calendarTime: 'x', unixTime: '1', severity: '0', filename: 'init.cpp', line: '1', message: 'osquery iniciado', version: '5.12.1' }];
    let r = await chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'status', data: status } });
    assert.deepEqual(r.body, {});
    let estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
    assert.ok(estacao.vistaEm > antes);
    assert.equal(estacao.inventarioEm, null);

    await prisma.workstation.update({ where: { hostIdentifier }, data: { vistaEm: antes } });
    r = await chamar('POST', LOGGER, {
      body: { node_key: nodeKey, log_type: 'result', data: [{ name: 'outra_query', snapshot: [{ a: '1' }] }, 'lixo', { diffResults: {} }] },
    });
    assert.deepEqual(r.body, {});
    estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
    assert.ok(estacao.vistaEm > antes);
    assert.equal(estacao.inventarioEm, null);
  });

  it('chave desconhecida: node_invalid, sem gravar nada', async () => {
    const r = await chamar('POST', LOGGER, {
      body: { node_key: randomBytes(32).toString('hex'), log_type: 'result', data: [snapshot('baluarte_portas', 'x', [{ port: '22', protocol: '6', address: '0.0.0.0' }])] },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { node_invalid: true });
  });

  it('corpo inválido: 400 com o código do campo', async () => {
    const { nodeKey } = await inscrever();
    esperaErro(await chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'event', data: [] } }), 400, 'LOG_TYPE_INVALIDO');
    esperaErro(await chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'result', data: {} } }), 400, 'DATA_INVALIDO');
    esperaErro(await chamar('POST', LOGGER, { body: { log_type: 'result', data: [] } }), 400, 'NODE_KEY_INVALIDA');
  });

  it('aceita o inventário inteiro acima do limite de 64 kB das outras rotas', async () => {
    const { nodeKey, hostIdentifier } = await inscrever();
    const linhas = Array.from({ length: 1500 }, (_, i) => ({ name: `Programa ${i} ${'x'.repeat(40)}`, version: `1.0.${i}`, fornecedor: 'Fornecedor' }));
    const r = await chamar('POST', LOGGER, { body: { node_key: nodeKey, log_type: 'result', data: [snapshot('baluarte_programas_windows', hostIdentifier, linhas)] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await prisma.workstationSoftware.count({ where: { workstation: { hostIdentifier } } }), 1500);
  });
});

describe('ativo da estação', () => {
  it('POST /assets continua recusando o tipo "Estação de trabalho" (só a inscrição cria)', async () => {
    const analista = await login(ANALISTA.email, ANALISTA.senha);
    const r = await chamar('POST', '/assets', { token: analista, body: { nome: 'PC', tipo: 'Estação de trabalho', host: `pc-${++seq}.empresa.local` } });
    esperaErro(r, 400, 'TIPO_INVALIDO');
  });

  it('a estação aparece em GET /assets com o tipo próprio', async () => {
    const { hostname } = await inscrever();
    const analista = await login(ANALISTA.email, ANALISTA.senha);
    const r = await chamar('GET', '/assets', { token: analista });
    const ativo = (r.body.dados as { host: string; tipo: string }[]).find((a) => a.host === hostname);
    assert.equal(ativo?.tipo, 'Estação de trabalho');
  });
});
