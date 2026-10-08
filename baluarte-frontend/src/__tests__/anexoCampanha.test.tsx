import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useRoutes } from 'react-router-dom';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { routes } from '@/routes';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { HttpError } from '@/lib/errors';
import { tokenStorage, userStorage } from '@/lib/storage';
import {
  MAX_ATTACHMENTS_PER_CAMPAIGN,
  OWN_RULE_LABEL,
  fileScanErrorMessage,
  fileScanVerdict,
  isOwnRule,
} from '@/lib/files';
import { configureMocks, mockApi, resetMockState } from '@/mocks/api';
import { COLLAB_RECIPIENT_ID, MOCK_USERS } from '@/mocks/data';
import { httpClient, realApi } from '@/services/api';
import {
  toCampaignAttachments,
  toCampaignReport,
  toFileScan,
  toReceivedCampaigns,
  type BackendCampaignReport,
} from '@/services/adapters';

// B23: regra YARA própria do Baluarte (rótulo "regra própria do Baluarte") e anexo suspeito
// recebido numa campanha, enviado para análise pelo destinatário (com login), com a campanha
// pré-selecionada a partir do treinamento ou do reporte, e os anexos no relatório da campanha.
// Nada de material malicioso: o marcador de teste é montado em partes, em memória.

// Sob a suíte inteira (30 arquivos em paralelo) o envio no mock passa de 1 s às vezes.
const ESPERA = { timeout: 5000 };

const MARCADOR = ['BALUARTE', 'TESTE', 'AMEACA', '0001', 'ARQUIVO', 'INOFENSIVO'].join('-');
const MACRO = ['Sub Document', '_Open()\n', '  Set s = Create', 'Object("WScript.', 'Shell")\n'].join('');

function Routed() {
  return useRoutes(routes);
}

function Where() {
  const location = useLocation();
  return <span data-testid="where">{`${location.pathname}${location.search}`}</span>;
}

function session(role: RBACRole) {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated' as const, token, user };
}

function renderAt(path: string, role: RBACRole | null) {
  const initialSession = role ? session(role) : { status: 'anonymous' as const, token: null, user: null };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={initialSession} revalidateOnMount={false}>
        <Routed />
        <Where />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function choose(file: File) {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });
}

async function loginAs(role: RBACRole) {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const token = buildMockToken({ sub: found.id, email: found.email, name: found.name, role: found.role });
  tokenStorage.set(token);
  return found;
}

beforeEach(() => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
  tokenStorage.clear();
  userStorage.clear();
  vi.restoreAllMocks();
});

describe('regra própria do Baluarte: veredito -> rótulo (B23)', () => {
  it('só as regras YARA do Baluarte ganham o rótulo; assinatura oficial e YARA de terceiros, não', () => {
    expect(OWN_RULE_LABEL).toBe('regra própria do Baluarte');
    expect(isOwnRule('YARA.BaluarteMarcadorTeste.UNOFFICIAL')).toBe(true);
    expect(isOwnRule('YARA.BaluarteMacroSuspeita.UNOFFICIAL')).toBe(true);
    for (const outro of [
      'Eicar-Signature',
      'YARA.OutraEmpresa.UNOFFICIAL',
      'YARA.BaluarteMacro',
      null,
      undefined,
    ])
      expect(isOwnRule(outro)).toBe(false);
  });

  it('o veredito em uma linha leva o rótulo só na regra própria', () => {
    expect(fileScanVerdict({ result: 'threat', threat: 'YARA.BaluarteMarcadorTeste.UNOFFICIAL' })).toBe(
      'Ameaça encontrada: YARA.BaluarteMarcadorTeste.UNOFFICIAL (regra própria do Baluarte)',
    );
    expect(fileScanVerdict({ result: 'threat', threat: 'Eicar-Signature' })).toBe(
      'Ameaça encontrada: Eicar-Signature',
    );
  });

  it('o adaptador lê regraPropria e campanha (e deriva o rótulo de servidor antigo sem o campo)', () => {
    const base = {
      id: 'a1',
      nome: 'fatura.txt',
      tamanho: 10,
      sha256: 'A'.repeat(64),
      resultado: 'AMEACA',
      ameaca: 'YARA.BaluarteMarcadorTeste.UNOFFICIAL',
      analisadoEm: '2026-10-08T12:00:00.000Z',
    };
    expect(toFileScan({ ...base, regraPropria: true, campanha: { id: 'c1', nome: 'Fatura' } })).toMatchObject(
      {
        ownRule: true,
        campaign: { id: 'c1', name: 'Fatura' },
      },
    );
    expect(toFileScan(base)).toMatchObject({ ownRule: true, campaign: null });
    expect(toFileScan({ ...base, resultado: 'LIMPO', ameaca: null, regraPropria: false })).toMatchObject({
      ownRule: false,
    });
  });

  it('a mensagem de cada erro do anexo de campanha', () => {
    expect(fileScanErrorMessage(new HttpError(404, 'CAMPANHA_NAO_RECEBIDA', 'x'))).toMatch(
      /não está entre as que você recebeu/,
    );
    expect(fileScanErrorMessage(new HttpError(429, 'LIMITE_ANEXOS_CAMPANHA', 'x'))).toContain(
      `${MAX_ATTACHMENTS_PER_CAMPAIGN} anexos desta campanha`,
    );
    expect(fileScanErrorMessage(new HttpError(429, 'MUITAS_ANALISES', 'x'))).toMatch(
      /limite de análises por hora/,
    );
  });
});

describe('tela /files: rótulo da regra própria (B23)', () => {
  it('o marcador de teste do Baluarte aparece como ameaça com o rótulo "regra própria do Baluarte"', async () => {
    renderAt('/files', 'collaborator');
    await screen.findByText('Análises anteriores', undefined, ESPERA);
    choose(new File([`relatorio\n${MARCADOR}\n`], 'marcador.txt', { type: 'text/plain' }));

    const verdict = await screen.findByTestId('file-verdict', undefined, ESPERA);
    expect(verdict).toHaveAttribute('data-result', 'threat');
    expect(verdict).toHaveTextContent('YARA.BaluarteMarcadorTeste.UNOFFICIAL');
    expect(within(verdict).getByTestId('own-rule-label')).toHaveTextContent('regra própria do Baluarte');
    expect(screen.getByTestId('file-scan-announcer')).toHaveTextContent('(regra própria do Baluarte)');
    // No histórico, a linha nova também leva o rótulo.
    const card = screen.getByText('Análises anteriores').closest('section')!;
    await waitFor(() => {
      const row = within(card).getAllByTestId('file-history-row')[0];
      expect(row).toHaveTextContent('marcador.txt');
      expect(within(row).getByTestId('own-rule-label')).toBeInTheDocument();
    }, ESPERA);
  });

  it('assinatura oficial (EICAR) não leva o rótulo', async () => {
    renderAt('/files', 'collaborator');
    await screen.findByText('Análises anteriores', undefined, ESPERA);
    choose(new File(['X5O EICAR teste'], 'eicar.txt'));
    const verdict = await screen.findByTestId('file-verdict', undefined, ESPERA);
    expect(verdict).toHaveAttribute('data-result', 'threat');
    expect(within(verdict).queryByTestId('own-rule-label')).not.toBeInTheDocument();
  });
});

describe('anexo suspeito de campanha: envio a partir da campanha (B23)', () => {
  it('pelo link do e-mail (?link=), a campanha vem pré-selecionada, o envio liga a análise a ela e o token sai da URL', async () => {
    const spy = vi.spyOn(mockApi, 'analyzeFile');
    renderAt(`/files?link=${COLLAB_RECIPIENT_ID}`, 'collaborator');
    const select = (await screen.findByTestId('file-campaign')) as HTMLSelectElement;
    await waitFor(() => expect(select).toHaveValue(COLLAB_RECIPIENT_ID));
    expect(select.selectedOptions[0]).toHaveTextContent('Campanha Junho 2026 – Urgência');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/files$/));

    choose(new File([MACRO], 'pedido.doc'));
    const verdict = await screen.findByTestId('file-verdict', undefined, ESPERA);
    expect(verdict).toHaveTextContent('YARA.BaluarteMacroSuspeita.UNOFFICIAL');
    expect(within(verdict).getByTestId('own-rule-label')).toBeInTheDocument();
    expect(screen.getByTestId('result-campaign')).toHaveTextContent('Campanha Junho 2026 – Urgência');
    expect(spy.mock.calls[0][1]).toMatchObject({ campaignEventId: COLLAB_RECIPIENT_ID });
  });

  it('do treinamento dentro do sistema (?campanha=) também pré-seleciona; "envio avulso" desliga a origem', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, 'analyzeFile');
    renderAt(`/files?campanha=${COLLAB_RECIPIENT_ID}`, 'collaborator');
    const select = await screen.findByTestId('file-campaign');
    await waitFor(() => expect(select).toHaveValue(COLLAB_RECIPIENT_ID));
    await user.selectOptions(select, '');
    choose(new File(['ata'], 'ata.txt'));
    await screen.findByTestId('file-verdict', undefined, ESPERA);
    expect(spy.mock.calls[0][1]?.campaignEventId).toBeUndefined();
    expect(screen.queryByTestId('result-campaign')).not.toBeInTheDocument();
  });

  it('link de outra pessoa ou desconhecido: nada é pré-selecionado e a tela avisa', async () => {
    renderAt('/files?link=camp-001-r-01', 'collaborator');
    expect(await screen.findByTestId('file-campaign-missing')).toBeInTheDocument();
    expect(screen.getByTestId('file-campaign')).toHaveValue('');
  });

  it('quem não recebeu campanha não vê o seletor', async () => {
    renderAt('/files', 'analyst');
    await screen.findByText('Análises anteriores', undefined, ESPERA);
    expect(screen.queryByTestId('file-campaign')).not.toBeInTheDocument();
  });

  it('sem login, o link de envio leva ao login e, depois dele, de volta à análise com o link', async () => {
    renderAt(`/files?link=${COLLAB_RECIPIENT_ID}`, null);
    expect(await screen.findByTestId('where')).toHaveTextContent('/login');
  });

  it('as páginas públicas do treinamento e do reporte levam à análise com o token do link', async () => {
    const treino = renderAt(`/t/${COLLAB_RECIPIENT_ID}`, null);
    const link = await screen.findByTestId('send-attachment');
    expect(link).toHaveAttribute('href', `/files?link=${COLLAB_RECIPIENT_ID}`);
    treino.unmount();
    renderAt(`/t/${COLLAB_RECIPIENT_ID}/reportar`, null);
    expect(await screen.findByTestId('send-attachment')).toHaveAttribute(
      'href',
      `/files?link=${COLLAB_RECIPIENT_ID}`,
    );
  });

  it('mock espelha o servidor: campanha de outra pessoa dá 404 e o 6.º anexo da campanha dá 429', async () => {
    await loginAs('analyst');
    await expect(
      mockApi.analyzeFile(new File(['x'], 'x.txt'), { campaignEventId: COLLAB_RECIPIENT_ID }),
    ).rejects.toMatchObject({ status: 404, code: 'CAMPANHA_NAO_RECEBIDA' });
    await loginAs('collaborator');
    // O seed já tem um anexo desta campanha (fatura-junho.pdf).
    for (let i = 1; i < MAX_ATTACHMENTS_PER_CAMPAIGN; i += 1)
      await mockApi.analyzeFile(new File([`a${i}`], `a${i}.txt`), { campaignEventId: COLLAB_RECIPIENT_ID });
    await expect(
      mockApi.analyzeFile(new File(['mais'], 'mais.txt'), { campaignEventId: COLLAB_RECIPIENT_ID }),
    ).rejects.toMatchObject({ status: 429, code: 'LIMITE_ANEXOS_CAMPANHA' });
    const recebidas = await mockApi.listReceivedCampaigns();
    expect(recebidas.items[0]).toMatchObject({
      id: COLLAB_RECIPIENT_ID,
      attachmentsSent: MAX_ATTACHMENTS_PER_CAMPAIGN,
    });
  });
});

describe('relatório da campanha: anexos reportados (B23)', () => {
  it('operadores veem quantos anexos foram reportados e os vereditos, com o rótulo de regra própria', async () => {
    await loginAs('collaborator');
    await mockApi.analyzeFile(new File([MARCADOR], 'comprovante.txt'), {
      campaignEventId: COLLAB_RECIPIENT_ID,
    });
    renderAt('/campaigns/camp-002', 'analyst');
    const card = await screen.findByTestId('campaign-attachments');
    expect(card).toHaveTextContent('2 anexos reportados · 1 com ameaça · 1 por regra própria do Baluarte');
    const rows = within(card).getAllByTestId('campaign-attachment-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('comprovante.txt');
    expect(rows[0]).toHaveTextContent('colaborador@empresa.com');
    expect(within(rows[0]).getByTestId('own-rule-label')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('fatura-junho.pdf');
    expect(rows[1]).toHaveTextContent('Sem ameaça conhecida');
  });

  it('campanha sem anexos mostra o estado vazio', async () => {
    renderAt('/campaigns/camp-001', 'analyst');
    const card = await screen.findByTestId('campaign-attachments');
    expect(card).toHaveTextContent('Nenhum anexo reportado');
  });

  it('adaptadores do relatório e das campanhas recebidas', () => {
    const anexos = toCampaignAttachments({
      total: 1,
      ameacas: 1,
      regrasProprias: 1,
      lista: [
        {
          id: 'f1',
          nome: 'x.doc',
          sha256: 'B'.repeat(64),
          resultado: 'AMEACA',
          ameaca: 'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
          regraPropria: true,
          analisadoEm: '2026-10-08T12:00:00.000Z',
          destinatario: 'ana@empresa.com',
        },
      ],
    });
    expect(anexos).toEqual({
      total: 1,
      threats: 1,
      ownRules: 1,
      items: [
        {
          id: 'f1',
          name: 'x.doc',
          sha256: 'b'.repeat(64),
          result: 'threat',
          threat: 'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
          ownRule: true,
          scannedAt: '2026-10-08T12:00:00.000Z',
          recipient: 'ana@empresa.com',
        },
      ],
    });
    // Servidor antigo sem `anexos`: zerado, nunca quebra a tela.
    const semAnexos = toCampaignReport({
      id: 'c1',
      nome: 'C',
      template: 'urgencia',
      status: 'ATIVA',
      criadoEm: '2026-10-01T10:00:00.000Z',
      destinatarios: 0,
      funil: {
        enviados: { valor: 0, pct: 0 },
        abertos: { valor: 0, pct: 0 },
        clicados: { valor: 0, pct: 0 },
        submeteram: { valor: 0, pct: 0 },
        reportaram: { valor: 0, pct: 0 },
      },
      treinamentos: [],
    } as BackendCampaignReport);
    expect(semAnexos.attachments).toEqual({ total: 0, threats: 0, ownRules: 0, items: [] });

    const recebidas = toReceivedCampaigns(
      [
        {
          id: 'e1',
          campanha: { id: 'c1', nome: 'Fatura' },
          recebidaEm: '2026-10-08T12:00:00.000Z',
          anexosEnviados: 2,
        },
      ],
      { selecionada: 'e1' },
    );
    expect(recebidas).toEqual({
      items: [
        {
          id: 'e1',
          campaign: { id: 'c1', name: 'Fatura' },
          receivedAt: '2026-10-08T12:00:00.000Z',
          attachmentsSent: 2,
        },
      ],
      selected: 'e1',
    });
    // Seleção que não está na lista não vale.
    expect(toReceivedCampaigns([], { selecionada: 'e9' }).selected).toBeNull();
  });
});

describe('realApi: origem na query e campanhas recebidas (B23)', () => {
  const original = httpClient.defaults.adapter;
  let calls: InternalAxiosRequestConfig[] = [];

  beforeEach(() => {
    calls = [];
    const fake: AxiosAdapter = async (config) => {
      calls.push(config);
      const key = `${config.method?.toUpperCase()} ${config.url}`;
      const dados =
        key === 'POST /arquivos/analise'
          ? {
              id: 'f1',
              nome: 'a.txt',
              tamanho: 1,
              sha256: 'c'.repeat(64),
              resultado: 'LIMPO',
              ameaca: null,
              analisadoEm: '2026-10-08T12:00:00.000Z',
              regraPropria: false,
              campanha: { id: 'c1', nome: 'Fatura' },
            }
          : key === 'GET /arquivos/campanhas-recebidas'
            ? []
            : null;
      if (dados === null) throw new AxiosError(`rota não configurada: ${key}`);
      return {
        data: { status: 'sucesso', dados, resumo: { selecionada: null } },
        status: 200,
        statusText: '',
        headers: {},
        config,
      };
    };
    httpClient.defaults.adapter = fake;
  });

  afterEach(() => {
    httpClient.defaults.adapter = original;
  });

  it('o anexo de campanha leva eventoCampanha na query; o envio avulso não', async () => {
    const comCampanha = await realApi.analyzeFile(new File(['a'], 'a.txt'), { campaignEventId: 'evt-1' });
    expect(calls[0].params).toEqual({ eventoCampanha: 'evt-1' });
    expect(comCampanha.scan.campaign).toEqual({ id: 'c1', name: 'Fatura' });
    await realApi.analyzeFile(new File(['a'], 'a.txt'));
    expect(calls[1].params).toBeUndefined();
  });

  it('GET /arquivos/campanhas-recebidas com o token do link só quando ele existe', async () => {
    await realApi.listReceivedCampaigns('f'.repeat(64));
    expect(calls[0].params).toEqual({ link: 'f'.repeat(64) });
    await realApi.listReceivedCampaigns();
    expect(calls[1].params).toBeUndefined();
  });
});
