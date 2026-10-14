import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { vulnerabilityReportFilename } from '@/lib/download';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { mockApi, resetMockState } from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';
import { httpClient, realApi } from '@/services/api';

// Melhorias #16 e #17 (parte de cliente): filtro por ativo (`assetId` → `ativoId`) na lista e
// nos relatórios, e o download do relatório em Excel (.xlsx) como Blob, igual ao PDF. O botão
// da tela é da sessão Frontend; aqui só o contrato do cliente e o espelho no mock.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function login(role: RBACRole): AuthUser {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  tokenStorage.set(buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role }));
  userStorage.set(user);
  return user;
}

describe('nome padrão do relatório', () => {
  it('em Excel termina em .xlsx; sem extensão, continua .pdf', () => {
    const date = new Date(2026, 9, 13, 23, 59);
    expect(vulnerabilityReportFilename(date, 'xlsx')).toBe('baluarte-vulnerabilidades-2026-10-13.xlsx');
    expect(vulnerabilityReportFilename(date)).toBe('baluarte-vulnerabilidades-2026-10-13.pdf');
  });
});

describe('realApi: filtro por ativo e relatório em Excel', () => {
  let calls: InternalAxiosRequestConfig[];
  let reply: (config: InternalAxiosRequestConfig) => {
    status: number;
    data: unknown;
    headers?: Record<string, string>;
  };
  const originalAdapter = httpClient.defaults.adapter;

  beforeEach(() => {
    calls = [];
    tokenStorage.set('token-de-teste');
    const adapter: AxiosAdapter = async (config) => {
      calls.push(config);
      const r = reply(config);
      const response = { data: r.data, status: r.status, statusText: '', headers: r.headers ?? {}, config };
      if (r.status >= 400)
        throw new AxiosError(`HTTP ${r.status}`, 'ERR_BAD_RESPONSE', config, null, response);
      return response;
    };
    httpClient.defaults.adapter = adapter;
  });
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  it('pede a planilha como blob em /relatorio.xlsx, com os filtros (ativoId incluso) e o token', async () => {
    const xlsx = new Blob(['PK'], { type: XLSX });
    reply = () => ({
      status: 200,
      data: xlsx,
      headers: { 'content-disposition': 'attachment; filename="baluarte-vulnerabilidades-2026-10-13.xlsx"' },
    });
    const report = await realApi.exportVulnerabilityReportExcel({
      severity: 'critical',
      status: 'open',
      query: ' sql ',
      assetId: ' ativo-001 ',
    });
    expect(report).toEqual({ blob: xlsx, filename: 'baluarte-vulnerabilidades-2026-10-13.xlsx' });
    expect(calls[0].method).toBe('get');
    expect(calls[0].url).toBe('/vulnerabilidades/relatorio.xlsx');
    expect(calls[0].responseType).toBe('blob');
    expect(String(calls[0].headers?.Accept)).toBe(XLSX);
    expect(calls[0].params).toEqual({
      severidade: 'Crítico',
      status: 'Aberta',
      q: 'sql',
      ativoId: 'ativo-001',
    });
    expect(String(calls[0].headers?.Authorization)).toBe('Bearer token-de-teste');
  });

  it('sem filtros não manda parâmetros e, sem Content-Disposition, usa o nome padrão .xlsx', async () => {
    reply = () => ({ status: 200, data: new Blob(['PK']) });
    const report = await realApi.exportVulnerabilityReportExcel();
    expect(calls[0].params).toEqual({});
    expect(report.filename).toBe(vulnerabilityReportFilename(new Date(), 'xlsx'));
  });

  it('erro na planilha: lê o envelope JSON de dentro do blob (ex.: ativo inexistente)', async () => {
    reply = () => ({
      status: 404,
      data: new Blob(
        [
          JSON.stringify({
            status: 'erro',
            mensagem: 'Ativo não encontrado',
            codigoErro: 'ATIVO_NAO_ENCONTRADO',
          }),
        ],
        { type: 'application/json' },
      ),
    });
    await expect(realApi.exportVulnerabilityReportExcel({ assetId: 'ativo-x' })).rejects.toMatchObject({
      status: 404,
      code: 'ATIVO_NAO_ENCONTRADO',
      message: 'Ativo não encontrado',
    });
  });

  it('o PDF e a lista paginada também mandam ativoId; vazio não vai', async () => {
    reply = (config) =>
      config.url === '/vulnerabilidades'
        ? {
            status: 200,
            data: { status: 'sucesso', dados: [], resumo: { total: 0, ativos: 0, pagina: 1, tamanho: 20 } },
          }
        : { status: 200, data: new Blob(['%PDF-']) };
    await realApi.exportVulnerabilityReport({ assetId: 'ativo-002' });
    expect(calls[0].url).toBe('/vulnerabilidades/relatorio.pdf');
    expect(calls[0].params).toEqual({ ativoId: 'ativo-002' });
    await realApi.listVulnerabilities({ assetId: 'ativo-002', severity: 'high' }, { page: 2, pageSize: 10 });
    expect(calls[1].params).toEqual({ ativoId: 'ativo-002', severidade: 'Alto', pagina: '2', tamanho: '10' });
    await realApi.listVulnerabilities({ assetId: '   ' });
    expect(calls[2].params).not.toHaveProperty('ativoId');
  });
});

describe('mockApi: espelho do servidor', () => {
  beforeEach(() => resetMockState());

  it('filtro por ativo restringe a lista e o resumo; ativo inexistente é 404', async () => {
    login('analyst');
    const all = await mockApi.listVulnerabilities({}, { pageSize: 100 });
    const assetId = all.items[0].assetId;
    const expected = all.items.filter((v) => v.assetId === assetId).length;
    const filtered = await mockApi.listVulnerabilities({ assetId }, { pageSize: 100 });
    expect(filtered.summary.total).toBe(expected);
    expect(filtered.summary.assets).toBe(1);
    expect(filtered.items.every((v) => v.assetId === assetId)).toBe(true);
    // Ativo de estação monitorada (fora de MOCK_ASSETS) também é um ativo existente.
    const station = await mockApi.listVulnerabilities({ assetId: 'asset-ws-001' }, { pageSize: 100 });
    expect(station.items.every((v) => v.assetId === 'asset-ws-001')).toBe(true);
    await expect(mockApi.listVulnerabilities({ assetId: 'ativo-inexistente' })).rejects.toMatchObject({
      status: 404,
      code: 'ATIVO_NAO_ENCONTRADO',
    });
  });

  it('o PDF do mock leva o ativo no filtro e na auditoria (com id e formato)', async () => {
    login('analyst');
    const all = await mockApi.listVulnerabilities({}, { pageSize: 100 });
    const vuln = all.items[0];
    await mockApi.exportVulnerabilityReport({ assetId: vuln.assetId });
    login('admin');
    const audit = await mockApi.listAuditLog({ action: 'EXPORTAR_RELATORIO_VULNERABILIDADES' });
    expect(audit.items[0].detail).toContain(
      `; ativo: ${vuln.assetName} (${vuln.assetHost}) [${vuln.assetId}]; formato: PDF`,
    );
  });

  it('Excel no modo mock: 403 para o Colaborador e 501 explícito para quem pode (sem auditoria)', async () => {
    login('collaborator');
    await expect(mockApi.exportVulnerabilityReportExcel()).rejects.toMatchObject({ status: 403 });
    login('analyst');
    await expect(mockApi.exportVulnerabilityReportExcel()).rejects.toMatchObject({
      status: 501,
      code: 'NAO_IMPLEMENTADO',
    });
    login('admin');
    const audit = await mockApi.listAuditLog({ action: 'EXPORTAR_RELATORIO_VULNERABILIDADES' });
    expect(audit.items).toHaveLength(0);
  });
});
