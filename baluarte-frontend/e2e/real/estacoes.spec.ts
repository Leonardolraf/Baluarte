import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, ANALYST, API_URL, COLLABORATOR, apiToken, bearer, signIn, unique } from './apoio';

// B07/B13/B14 — estações monitoradas contra a API real. A estação é inscrita simulando o
// osquery (plugin tls) pelas rotas públicas do agente: /agentes/osquery/enroll com o segredo
// desta instância (E2E_OSQUERY_SECRET, gerado pelo orquestrador) e /agentes/osquery/logger
// com o inventário. O "Verificar vulnerabilidades" consulta o OSV/NVD FALSO local
// (scripts/e2e/bases-falsas.mjs, E2E_BASES_URL): nunca as bases públicas.

const SEGREDO = process.env.E2E_OSQUERY_SECRET;
const BASES_URL = process.env.E2E_BASES_URL;

const UBUNTU = { name: 'Ubuntu', version: '22.04.4 LTS (Jammy Jellyfish)', platform: 'ubuntu', build: '' };
const PORTAS = [
  { port: '22', protocol: '6', address: '0.0.0.0', processo: 'sshd' },
  { port: '5432', protocol: '6', address: '127.0.0.1', processo: 'postgres' },
  { port: '68', protocol: '17', address: '0.0.0.0', processo: 'dhclient' },
];

type Linha = Record<string, string>;

function evento(nome: string, hostIdentifier: string, linhas: Linha[]) {
  return {
    name: nome,
    hostIdentifier,
    action: 'snapshot',
    snapshot: linhas,
    calendarTime: new Date().toUTCString(),
    unixTime: Math.floor(Date.now() / 1000),
    epoch: 0,
    counter: 0,
    numerics: false,
  };
}

const deb = (name: string, version: string): Linha => ({ name, version, fornecedor: 'Ubuntu Developers' });

/**
 * Pacotes de uma estação Ubuntu. openssl e curl têm vulnerabilidade na base falsa; a versão
 * leva um sufixo único para cada teste consultar a base (o cache do banco é por versão).
 */
function pacotes(extra: Linha[] = []): Linha[] {
  const sufixo = `+e2e${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return [
    deb('openssl', `3.0.2-0ubuntu1.10${sufixo}`),
    deb('curl', `7.81.0-1ubuntu1.13${sufixo}`),
    deb('bash', '5.1-6ubuntu1'),
    deb('libc6', '2.35-0ubuntu3.6'),
    ...extra,
  ];
}

/** Inscreve uma estação como o osquery faria e envia o inventário (programas e portas). */
async function inscreverEstacao(request: APIRequestContext, programas: Linha[]) {
  const hostIdentifier = unique('e2e-ws').replace(/\./g, '-');
  const nome = `WS-${hostIdentifier.slice(-12)}`;
  const host = `${hostIdentifier}.empresa.local`;
  const inscricao = await request.post(`${API_URL}/agentes/osquery/enroll`, {
    data: {
      enroll_secret: SEGREDO,
      host_identifier: hostIdentifier,
      host_details: { os_version: UBUNTU, system_info: { hostname: host, computer_name: nome } },
    },
  });
  expect(inscricao.status(), 'inscrição do osquery').toBe(200);
  const { node_key: nodeKey } = (await inscricao.json()) as { node_key: string };
  expect(nodeKey).toMatch(/^[0-9a-f]{64}$/);

  const log = await request.post(`${API_URL}/agentes/osquery/logger`, {
    data: {
      node_key: nodeKey,
      log_type: 'result',
      data: [
        evento('baluarte_programas_deb', hostIdentifier, programas),
        evento('baluarte_portas', hostIdentifier, PORTAS),
      ],
    },
  });
  expect(log.status()).toBe(200);
  expect(await log.json()).toEqual({});
  return { nome, host };
}

async function pedidosAsBases(request: APIRequestContext): Promise<{ OSV: number; NVD: number }> {
  const r = await request.get(`${BASES_URL}/__pedidos`);
  expect(r.ok(), 'bases falsas no ar').toBeTruthy();
  return (await r.json()) as { OSV: number; NVD: number };
}

test.describe('Estações monitoradas (API real, agente osquery simulado)', () => {
  test.skip(
    !SEGREDO,
    'defina E2E_OSQUERY_SECRET com o OSQUERY_ENROLL_SECRET da API (o orquestrador faz isso)',
  );

  test('a estação inscrita aparece na lista e no detalhe com programas e portas', async ({
    page,
    request,
  }) => {
    const programas = pacotes();
    const estacao = await inscreverEstacao(request, programas);

    await signIn(page, ANALYST.email, ANALYST.password);
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await nav.getByRole('link', { name: 'Estações' }).click();
    await expect(page).toHaveURL(/\/stations$/);
    await expect(page.getByRole('heading', { name: 'Estações monitoradas' })).toBeVisible();

    const linha = page.getByTestId('station-row').filter({ hasText: estacao.nome });
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText(estacao.host);
    await expect(linha).toContainText('Ubuntu');
    await expect(linha).toContainText('Online');

    await linha.getByRole('link', { name: estacao.nome }).click();
    await expect(page).toHaveURL(/\/stations\/[^/]+$/);
    await expect(page.getByRole('heading', { name: estacao.nome })).toBeVisible();
    await expect(page.getByText('Nunca verificada')).toBeVisible();

    await expect(page.getByRole('tab', { name: /Programas instalados/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('software-row')).toHaveCount(programas.length);
    await page.getByLabel('Filtrar programas').fill('openssl');
    await expect(page.getByTestId('software-row')).toHaveCount(1);
    await expect(page.getByTestId('software-row')).toContainText(programas[0]!.version!);

    await page.getByRole('tab', { name: /Portas abertas/ }).click();
    await expect(page.getByTestId('port-row')).toHaveCount(PORTAS.length);
    const postgres = page.getByTestId('port-row').filter({ hasText: '5432' });
    await expect(postgres).toContainText('127.0.0.1');
    await expect(postgres).toContainText('Só local');
    await expect(postgres).toContainText('postgres');
    await expect(page.getByTestId('port-row').filter({ hasText: 'dhclient' })).toContainText('UDP');
  });

  test('"Verificar vulnerabilidades" cruza o inventário com a base (falsa, local) e registra os achados (B14)', async ({
    page,
    request,
  }) => {
    test.skip(!BASES_URL, 'defina E2E_BASES_URL (OSV/NVD falsos); nunca consultar as bases públicas');
    const estacao = await inscreverEstacao(request, pacotes());
    const antes = await pedidosAsBases(request);

    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto('/stations');
    await page.getByTestId('station-row').filter({ hasText: estacao.nome }).getByRole('link').click();
    await expect(page.getByRole('heading', { name: estacao.nome })).toBeVisible();

    const verificar = page.getByRole('button', { name: 'Verificar vulnerabilidades' });
    await verificar.click();
    const resultado = page.getByTestId('verification-result');
    await expect(resultado).toContainText('Verificação concluída: 2 achados novos, 0 já registrados.');
    await expect(resultado).not.toContainText('Sem resposta');
    expect((await pedidosAsBases(request)).OSV).toBeGreaterThan(antes.OSV);

    // Depois da verificação, o detalhe recarrega: data da verificação e achados em aberto.
    await expect(page.getByText('Nunca verificada')).toHaveCount(0);
    const achados = page.getByRole('link', { name: /2 de 2/ });
    await expect(achados).toBeVisible();

    // Verificar de novo não duplica: os dois já estão registrados.
    await verificar.click();
    await expect(resultado).toContainText('Verificação concluída: 0 achados novos, 2 já registrados.');

    // O link leva à lista de vulnerabilidades filtrada pelo host da estação.
    await achados.click();
    await expect(page).toHaveURL(/\/vulnerabilities\?q=/);
    const rows = page.getByTestId('vuln-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'CVE-2023-38545' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'CVE-2023-5678' })).toHaveCount(1);
  });

  test('base fora do ar: a verificação avisa e não inventa achado', async ({ page, request }) => {
    test.skip(!BASES_URL, 'defina E2E_BASES_URL (OSV/NVD falsos); nunca consultar as bases públicas');
    // O pacote marcador faz o OSV falso responder 503 para o lote inteiro.
    const estacao = await inscreverEstacao(request, pacotes([deb('e2e-base-fora-do-ar', '1.0')]));

    await signIn(page, ANALYST.email, ANALYST.password);
    await page.goto('/stations');
    await page.getByTestId('station-row').filter({ hasText: estacao.nome }).getByRole('link').click();
    await page.getByRole('button', { name: 'Verificar vulnerabilidades' }).click();
    const resultado = page.getByTestId('verification-result');
    await expect(resultado).toContainText('0 achados novos');
    await expect(resultado).toContainText('Sem resposta de OSV');
    await expect(page.getByText('Achados em aberto').locator('..')).toContainText('0');
  });

  test('colaborador não vê Estações e a API recusa (RBAC do servidor)', async ({ page, request }) => {
    await inscreverEstacao(request, pacotes());
    const admin = await apiToken(request, ADMIN.email, ADMIN.password);
    const lista = await request.get(`${API_URL}/estacoes`, { headers: bearer(admin) });
    expect(lista.ok()).toBeTruthy();
    const { dados } = (await lista.json()) as { dados: Array<{ id: string }> };
    const id = dados[0]!.id;

    const colaborador = await apiToken(request, COLLABORATOR.email, COLLABORATOR.password);
    for (const [metodo, caminho] of [
      ['GET', '/estacoes'],
      ['GET', `/estacoes/${id}`],
      ['POST', `/estacoes/${id}/verificar`],
    ] as const) {
      const r = await request.fetch(`${API_URL}${caminho}`, { method: metodo, headers: bearer(colaborador) });
      expect(r.status(), `${metodo} ${caminho} para colaborador`).toBe(403);
    }

    await signIn(page, COLLABORATOR.email, COLLABORATOR.password);
    const nav = page.getByRole('navigation', { name: 'Navegação principal' }).first();
    await expect(nav.getByRole('link', { name: 'Estações' })).toHaveCount(0);
    for (const caminho of ['/stations', `/stations/${id}`]) {
      await page.goto(caminho);
      await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
    }
  });
});
