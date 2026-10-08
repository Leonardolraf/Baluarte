import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole, StationDetail, StationVerification } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { HttpError } from '@/lib/errors';
import { tokenStorage, userStorage } from '@/lib/storage';
import { formatWindow, listenScope } from '@/lib/stations';
import { mockApi } from '@/mocks/api';
import { buildMockStations, MOCK_STATION_OFFLINE_AFTER_SEC, MOCK_USERS } from '@/mocks/data';
import {
  toAsset,
  toStation,
  toStationDetail,
  toStationList,
  toStationVerification,
  type BackendStation,
} from '@/services/adapters';
import StationListPage from '@/pages/Stations/StationListPage';
import StationDetailPage from '@/pages/Stations/StationDetailPage';

// B13 — estações monitoradas: lista (status online/offline), detalhe com programas e
// portas, camada mock (RBAC e cálculo do status) e adapters do contrato do backend.

function session(role: RBACRole) {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated' as const, token, user };
}

function renderAt(path: string, role: RBACRole = 'analyst') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={session(role)} revalidateOnMount={false}>
        <Routes>
          <Route path="/stations" element={<StationListPage />} />
          <Route path="/stations/:id" element={<StationDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole('link', { name }).closest('tr')!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StationListPage', () => {
  it('lista nome, sistema, último contato e status, com o total de online e offline', async () => {
    renderAt('/stations');
    const rows = await screen.findAllByTestId('station-row');
    expect(rows).toHaveLength(5);
    // Ordem do servidor: por nome da máquina.
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual([
      'COM-NB-01',
      'dev-ws-02',
      'FIN-NB-07',
      'ops-ws-05',
      'RH-NB-03',
    ]);
    expect(within(rowOf('RH-NB-03')).getByText('Offline')).toBeInTheDocument();
    expect(within(rowOf('RH-NB-03')).getByText('Microsoft Windows 10 Pro 10.0.19045')).toBeInTheDocument();
    expect(within(rowOf('RH-NB-03')).getByText('há 2 dias')).toBeInTheDocument();
    expect(within(rowOf('dev-ws-02')).getByText('Online')).toBeInTheDocument();
    expect(within(rowOf('dev-ws-02')).getByText('Ubuntu 22.04.4 LTS (Jammy Jellyfish)')).toBeInTheDocument();
    expect(screen.getByText('4 online · 1 offline')).toBeInTheDocument();
    expect(screen.getByText('Contato nos últimos 15 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FIN-NB-07' })).toHaveAttribute('href', '/stations/ws-001');
    // Recém-inscrita, sem inventário: totais como "—", não como zero.
    expect(within(rowOf('COM-NB-01')).getAllByText('—')).toHaveLength(2);
  });

  it('mostra o estado vazio quando nenhuma estação se inscreveu', async () => {
    vi.spyOn(mockApi, 'listStations').mockResolvedValue({
      items: [],
      summary: { total: 0, online: 0, offline: 0, offlineAfterSec: 900 },
    });
    renderAt('/stations');
    expect(await screen.findByText('Nenhuma estação inscrita')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('mostra o erro e tenta de novo', async () => {
    const real = mockApi.listStations.bind(mockApi);
    vi.spyOn(mockApi, 'listStations')
      .mockRejectedValueOnce(new HttpError(503, 'SERVICO_INDISPONIVEL', 'Serviço indisponível'))
      .mockImplementation(real);
    const user = userEvent.setup();
    renderAt('/stations');
    expect(await screen.findByText('Serviço indisponível')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findAllByTestId('station-row')).toHaveLength(5);
  });

  it('mostra o carregamento enquanto a API não responde', async () => {
    vi.spyOn(mockApi, 'listStations').mockReturnValue(new Promise(() => undefined));
    renderAt('/stations');
    expect(await screen.findByText('Carregando estações…')).toBeInTheDocument();
  });

  it('colaborador recebe "Acesso negado" da API', async () => {
    renderAt('/stations', 'collaborator');
    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
  });
});

describe('StationDetailPage', () => {
  it('mostra os programas instalados, filtra e troca para as portas abertas', async () => {
    const user = userEvent.setup();
    renderAt('/stations/ws-002');
    expect(await screen.findByRole('heading', { name: 'dev-ws-02' })).toBeInTheDocument();
    expect(screen.getAllByText('Online').length).toBeGreaterThan(0);
    expect(screen.getByText('Fica offline após 15 min sem contato')).toBeInTheDocument();

    expect(screen.getByRole('tab', { name: /Programas instalados/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByTestId('software-row')).toHaveLength(8);
    const openssl = screen.getByText('openssl').closest('tr')!;
    expect(within(openssl).getByText('3.0.2-0ubuntu1.18')).toBeInTheDocument();
    expect(within(openssl).getByText('Ubuntu Developers')).toBeInTheDocument();
    expect(within(openssl).getByText('Pacote .deb')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Filtrar programas'), 'docker');
    expect(screen.getAllByTestId('software-row')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Filtrar programas'));
    await user.type(screen.getByLabelText('Filtrar programas'), 'nada-assim');
    expect(screen.getByText('Nenhum programa com esse filtro.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Portas abertas/ }));
    const ports = screen.getAllByTestId('port-row');
    expect(ports).toHaveLength(4);
    const postgres = ports.find((row) => within(row).queryByText('5432'))!;
    expect(within(postgres).getByText('127.0.0.1')).toBeInTheDocument();
    expect(within(postgres).getByText('Só local')).toBeInTheDocument();
    expect(within(postgres).getByText('postgres')).toBeInTheDocument();
    const dhcp = ports.find((row) => within(row).queryByText('68'))!;
    expect(within(dhcp).getByText('UDP')).toBeInTheDocument();
    expect(within(dhcp).getByText('Todas as interfaces')).toBeInTheDocument();
  });

  it('estação offline mostra o status Offline', async () => {
    renderAt('/stations/ws-003');
    expect(await screen.findByRole('heading', { name: 'RH-NB-03' })).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('estação sem inventário avisa que a coleta ainda não chegou', async () => {
    const user = userEvent.setup();
    renderAt('/stations/ws-005');
    expect(await screen.findByText('Aguardando a primeira coleta')).toBeInTheDocument();
    expect(screen.getByText(/ainda não enviou o inventário/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Portas abertas/ }));
    expect(screen.getByText(/ainda não enviou o inventário/)).toBeInTheDocument();
  });

  it('pagina inventários grandes de 25 em 25', async () => {
    const base = buildMockStations()[1]!;
    const software = Array.from({ length: 60 }, (_, i) => ({
      name: `pacote-${String(i).padStart(2, '0')}`,
      version: '1.0',
      vendor: null,
      source: 'deb_packages' as const,
    }));
    const big: StationDetail = {
      ...base,
      software,
      status: 'online',
      softwareCount: software.length,
      portCount: base.ports.length,
      offlineAfterSec: 900,
      verifiedAt: null,
      findingsTotal: 0,
      findingsOpen: 0,
    };
    vi.spyOn(mockApi, 'getStation').mockResolvedValue(big);
    const user = userEvent.setup();
    renderAt('/stations/ws-002');
    await screen.findByRole('heading', { name: 'dev-ws-02' });
    expect(screen.getAllByTestId('software-row')).toHaveLength(25);
    expect(screen.getByText('pacote-00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(screen.getByText('pacote-25')).toBeInTheDocument();
    expect(screen.queryByText('pacote-00')).not.toBeInTheDocument();
  });

  it('id inexistente mostra "Estação não encontrada"', async () => {
    renderAt('/stations/nao-existe');
    expect(await screen.findByRole('heading', { name: 'Estação não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para estações' })).toHaveAttribute('href', '/stations');
  });

  it('erro diferente de 404 oferece tentar de novo', async () => {
    vi.spyOn(mockApi, 'getStation').mockRejectedValue(new HttpError(503, 'X', 'Fora do ar'));
    renderAt('/stations/ws-001');
    expect(await screen.findByText('Não foi possível carregar a estação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

describe('mockApi — estações (B13)', () => {
  it('só Administrador e Analista leem as estações', async () => {
    session('collaborator');
    await expect(mockApi.listStations()).rejects.toMatchObject({ status: 403, code: 'PERFIL_SEM_PERMISSAO' });
    await expect(mockApi.getStation('ws-001')).rejects.toMatchObject({ status: 403 });
    for (const role of ['admin', 'analyst'] as const) {
      session(role);
      await expect(mockApi.listStations()).resolves.toMatchObject({ summary: { total: 5 } });
    }
  });

  it('calcula online/offline pela janela e devolve o inventário no detalhe', async () => {
    session('admin');
    const list = await mockApi.listStations();
    expect(list.summary).toEqual({
      total: 5,
      online: 4,
      offline: 1,
      offlineAfterSec: MOCK_STATION_OFFLINE_AFTER_SEC,
    });
    expect(list.items.find((s) => s.id === 'ws-003')?.status).toBe('offline');
    expect(list.items[0]).not.toHaveProperty('software');
    const detail = await mockApi.getStation('ws-001');
    expect(detail).toMatchObject({ softwareCount: 7, portCount: 5, status: 'online' });
    await expect(mockApi.getStation('ws-999')).rejects.toMatchObject({
      status: 404,
      code: 'ESTACAO_NAO_ENCONTRADA',
    });
  });

  it('a estação passa a offline quando o último contato sai da janela', async () => {
    session('admin');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + MOCK_STATION_OFFLINE_AFTER_SEC * 1000);
      const list = await mockApi.listStations();
      // FIN-NB-07 (2 min) e as outras com poucos minutos passam da janela; ops-ws-05 (6 min) também.
      expect(list.items.find((s) => s.id === 'ws-001')?.status).toBe('offline');
      expect(list.summary.offline).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('adapters — estações (B13)', () => {
  const raw: BackendStation = {
    id: 'cm1',
    ativoId: 'cm2',
    nome: 'fin-nb-07',
    host: 'fin-nb-07.empresa.local',
    identificador: '4c4c-uuid',
    sistema: 'Microsoft Windows 11 Pro 10.0.22631',
    soNome: 'Microsoft Windows 11 Pro',
    soVersao: '10.0.22631',
    soBuild: '22631',
    soPlataforma: 'windows',
    status: 'Offline',
    ultimoContato: '2026-10-08T10:00:00.000Z',
    inscritaEm: '2026-10-01T10:00:00.000Z',
    inventarioEm: null,
    totalProgramas: 0,
    totalPortas: 0,
  };

  it('converte a estação e o detalhe (campos em português para o domínio)', () => {
    expect(toStation({ ...raw, status: 'Online' })).toMatchObject({
      id: 'cm1',
      assetId: 'cm2',
      name: 'fin-nb-07',
      os: 'Microsoft Windows 11 Pro 10.0.22631',
      osPlatform: 'windows',
      status: 'online',
      lastSeenAt: '2026-10-08T10:00:00.000Z',
      inventoryAt: null,
    });
    const detail = toStationDetail({
      ...raw,
      janelaOfflineS: 10800,
      programas: [
        { nome: 'Chrome', versao: '129', fornecedor: 'Google LLC', fonte: 'programs' },
        { nome: 'x', versao: '', fornecedor: null, fonte: 'pkgng' },
      ],
      portas: [{ porta: 53, protocolo: 'UDP', endereco: '0.0.0.0', processo: null }],
    });
    expect(detail.status).toBe('offline');
    expect(detail.offlineAfterSec).toBe(10800);
    expect(detail.software).toEqual([
      { name: 'Chrome', version: '129', vendor: 'Google LLC', source: 'programs' },
      { name: 'x', version: '', vendor: null, source: 'other' },
    ]);
    expect(detail.ports).toEqual([{ port: 53, protocol: 'UDP', address: '0.0.0.0', process: null }]);
  });

  it('usa o resumo do servidor e calcula o que faltar', () => {
    expect(toStationList([raw], { total: 1, online: 0, offline: 1, janelaOfflineS: 900 }).summary).toEqual({
      total: 1,
      online: 0,
      offline: 1,
      offlineAfterSec: 900,
    });
    expect(toStationList([{ ...raw, status: 'Online' }, raw]).summary).toEqual({
      total: 2,
      online: 1,
      offline: 1,
      offlineAfterSec: 0,
    });
  });

  it('mapeia o tipo de ativo "Estação de trabalho"', () => {
    const asset = toAsset({
      id: 'a',
      nome: 'fin-nb-07',
      host: 'fin-nb-07.empresa.local',
      tipo: 'Estação de trabalho',
      status: 'Ativo',
      criadoEm: 'x',
    });
    expect(asset.type).toBe('workstation');
  });
});

describe('lib/stations', () => {
  it('formatWindow: minutos e horas', () => {
    expect(formatWindow(900)).toBe('15 min');
    expect(formatWindow(10800)).toBe('3 h');
    expect(formatWindow(5400)).toBe('1 h 30 min');
    expect(formatWindow(10)).toBe('1 min');
  });

  it('listenScope: todas as interfaces, só local ou específica', () => {
    expect(listenScope('0.0.0.0')).toBe('all');
    expect(listenScope('::')).toBe('all');
    expect(listenScope('127.0.0.1')).toBe('local');
    expect(listenScope('::1')).toBe('local');
    expect(listenScope('192.168.10.47')).toBe('specific');
  });
});

describe('mock — estações iniciais', () => {
  it('tem Windows e Linux, uma offline e ids únicos', () => {
    const stations = buildMockStations(Date.parse('2026-10-08T12:00:00Z'));
    expect(new Set(stations.map((s) => s.id)).size).toBe(stations.length);
    expect(stations.some((s) => s.osPlatform === 'windows')).toBe(true);
    expect(stations.some((s) => ['ubuntu', 'rhel'].includes(s.osPlatform ?? ''))).toBe(true);
    const offline = stations.filter(
      (s) =>
        Date.parse('2026-10-08T12:00:00Z') - Date.parse(s.lastSeenAt) > MOCK_STATION_OFFLINE_AFTER_SEC * 1000,
    );
    expect(offline.map((s) => s.id)).toEqual(['ws-003']);
  });
});

describe('B14 — verificar vulnerabilidades no detalhe da estação', () => {
  const resultado = (extra: Partial<StationVerification> = {}): StationVerification => ({
    verifiedAt: '2026-10-08T12:00:00.000Z',
    checkedPrograms: 7,
    uncoveredPrograms: 0,
    vulnerabilitiesFound: 3,
    newFindings: 3,
    existingFindings: 0,
    noCvss: 0,
    pending: 0,
    failures: [],
    ...extra,
  });

  it('antes da primeira verificação mostra "Nunca verificada" e nenhum achado', async () => {
    renderAt('/stations/ws-001');
    await screen.findByRole('heading', { name: 'FIN-NB-07' });
    expect(screen.getByText('Nunca verificada')).toBeInTheDocument();
    expect(screen.getByText('Achados em aberto')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /de 3/ })).not.toBeInTheDocument();
  });

  it('o Analista verifica: mostra o resultado, a data e o link para os achados em aberto', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, 'verifyStation');
    renderAt('/stations/ws-001');
    await screen.findByRole('heading', { name: 'FIN-NB-07' });
    await user.click(screen.getByRole('button', { name: 'Verificar vulnerabilidades' }));
    const status = await screen.findByTestId('verification-result');
    expect(spy).toHaveBeenCalledWith('ws-001');
    expect(status).toHaveTextContent('Verificação concluída: 3 achados novos, 0 já registrados.');
    expect(status).toHaveTextContent('7 programas consultados');
    const link = await screen.findByRole('link', { name: /3 de 3/ });
    expect(link).toHaveAttribute('href', '/vulnerabilities?q=fin-nb-07.empresa.local');
    expect(screen.queryByText('Nunca verificada')).not.toBeInTheDocument();
  });

  it('o Administrador também vê o botão', async () => {
    renderAt('/stations/ws-002', 'admin');
    await screen.findByRole('heading', { name: 'dev-ws-02' });
    expect(screen.getByRole('button', { name: 'Verificar vulnerabilidades' })).toBeEnabled();
  });

  it('estação sem inventário: botão desabilitado', async () => {
    renderAt('/stations/ws-005');
    await screen.findByRole('heading', { name: 'COM-NB-01' });
    expect(screen.getByRole('button', { name: 'Verificar vulnerabilidades' })).toBeDisabled();
  });

  it('base fora do ar e consultas pendentes aparecem no resultado', async () => {
    const user = userEvent.setup();
    vi.spyOn(mockApi, 'verifyStation').mockResolvedValue(
      resultado({
        newFindings: 0,
        existingFindings: 1,
        failures: ['OSV'],
        pending: 2,
        noCvss: 1,
        uncoveredPrograms: 4,
      }),
    );
    renderAt('/stations/ws-002');
    await screen.findByRole('heading', { name: 'dev-ws-02' });
    await user.click(screen.getByRole('button', { name: 'Verificar vulnerabilidades' }));
    const status = await screen.findByTestId('verification-result');
    expect(status).toHaveTextContent('0 achados novos, 1 já registrado.');
    expect(status).toHaveTextContent('Sem resposta de OSV');
    expect(status).toHaveTextContent('2 consultas ficaram para a próxima verificação');
    expect(status).toHaveTextContent('1 CVE sem nota CVSS');
    expect(status).toHaveTextContent('4 sem cobertura nas bases');
  });

  it('erro da API vira o banner de erro, sem resultado', async () => {
    const user = userEvent.setup();
    vi.spyOn(mockApi, 'verifyStation').mockRejectedValue(
      new HttpError(
        409,
        'VERIFICACAO_EM_ANDAMENTO',
        'Já existe uma verificação em andamento para esta estação',
      ),
    );
    renderAt('/stations/ws-002');
    await screen.findByRole('heading', { name: 'dev-ws-02' });
    await user.click(screen.getByRole('button', { name: 'Verificar vulnerabilidades' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma verificação em andamento');
    expect(screen.queryByTestId('verification-result')).not.toBeInTheDocument();
  });

  it('mockApi: só Administrador e Analista; a segunda verificação não cria nada; RHEL sem cobertura', async () => {
    session('collaborator');
    await expect(mockApi.verifyStation('ws-001')).rejects.toMatchObject({ status: 403 });
    session('analyst');
    await expect(mockApi.verifyStation('ws-999')).rejects.toMatchObject({
      status: 404,
      code: 'ESTACAO_NAO_ENCONTRADA',
    });
    expect(await mockApi.verifyStation('ws-003')).toMatchObject({ newFindings: 4, existingFindings: 0 });
    expect(await mockApi.verifyStation('ws-003')).toMatchObject({ newFindings: 0, existingFindings: 4 });
    const detail = await mockApi.getStation('ws-003');
    expect(detail).toMatchObject({ findingsTotal: 4, findingsOpen: 4 });
    expect(detail.verifiedAt).not.toBeNull();
    const list = await mockApi.listStations();
    expect(list.items.find((s) => s.id === 'ws-003')?.verifiedAt).toBe(detail.verifiedAt);
    expect(list.items[0]).not.toHaveProperty('findingsTotal');
    expect(await mockApi.verifyStation('ws-004')).toMatchObject({
      newFindings: 0,
      checkedPrograms: 0,
      uncoveredPrograms: 4,
    });
  });

  it('adapters: verificação e campos novos do detalhe', () => {
    expect(
      toStationVerification({
        verificadaEm: '2026-10-08T12:00:00.000Z',
        programasConsultados: 4,
        programasSemCobertura: 1,
        vulnerabilidadesEncontradas: 4,
        achadosNovos: 3,
        achadosExistentes: 0,
        semCvss: 1,
        pendentes: 0,
        falhas: ['NVD', 'OUTRA'],
      }),
    ).toEqual({
      verifiedAt: '2026-10-08T12:00:00.000Z',
      checkedPrograms: 4,
      uncoveredPrograms: 1,
      vulnerabilitiesFound: 4,
      newFindings: 3,
      existingFindings: 0,
      noCvss: 1,
      pending: 0,
      failures: ['NVD'],
    });
    const raw = {
      id: 'cm1',
      ativoId: 'cm2',
      nome: 'x',
      host: 'x.local',
      identificador: 'u',
      sistema: 'Ubuntu',
      status: 'Online',
      ultimoContato: '2026-10-08T10:00:00.000Z',
      inscritaEm: '2026-10-01T10:00:00.000Z',
      inventarioEm: null,
      totalProgramas: 0,
      totalPortas: 0,
      janelaOfflineS: 900,
      programas: [],
      portas: [],
    };
    expect(
      toStationDetail({
        ...raw,
        verificadaEm: '2026-10-08T11:00:00.000Z',
        totalAchados: 3,
        achadosAbertos: 2,
      }),
    ).toMatchObject({ verifiedAt: '2026-10-08T11:00:00.000Z', findingsTotal: 3, findingsOpen: 2 });
    // Backend sem os campos (antes do B14): valores neutros.
    expect(toStationDetail(raw)).toMatchObject({ verifiedAt: null, findingsTotal: 0, findingsOpen: 0 });
  });
});
