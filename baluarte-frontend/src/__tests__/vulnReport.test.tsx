import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { auditActionLabel } from '@/lib/audit';
import { filenameFromDisposition, saveBlob, vulnerabilityReportFilename } from '@/lib/download';
import { HttpError } from '@/lib/errors';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { configureMocks, mockApi } from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';
import { simplePdf } from '@/mocks/pdf';
import { httpClient, realApi } from '@/services/api';
import VulnListPage from '@/pages/Vulnerabilities/VulnListPage';

// B24 — exportar o relatório de vulnerabilidades em PDF: download pelo cliente da API
// (blob + nome do Content-Disposition), filtros da tela, PDF simples do modo mock,
// auditoria da exportação e o botão da tela (perfil, carregando, erro).

function login(role: RBACRole): AuthUser {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return user;
}

function renderPage(role: RBACRole) {
  const user = login(role);
  return render(
    <MemoryRouter initialEntries={['/vulnerabilities']}>
      <AuthProvider
        initialSession={{ status: 'authenticated', token: tokenStorage.get()!, user }}
        revalidateOnMount={false}
      >
        <VulnListPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob, 'latin1');
  });
}

/** Hexadecimal de um texto Latin-1 (como o PDF simples escreve). */
function hex(text: string): string {
  return Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

describe('download de arquivo (lib/download)', () => {
  it('lê o nome do Content-Disposition, sem caminho', () => {
    expect(filenameFromDisposition('attachment; filename="baluarte-vulnerabilidades-2026-10-08.pdf"')).toBe(
      'baluarte-vulnerabilidades-2026-10-08.pdf',
    );
    expect(filenameFromDisposition("attachment; filename*=UTF-8''relat%C3%B3rio.pdf")).toBe('relatório.pdf');
    expect(filenameFromDisposition('attachment; filename="../../etc/x.pdf"')).toBe('x.pdf');
    expect(filenameFromDisposition('attachment')).toBeNull();
    expect(filenameFromDisposition(null)).toBeNull();
  });

  it('nome padrão do relatório com a data local', () => {
    expect(vulnerabilityReportFilename(new Date(2026, 9, 8, 23, 59))).toBe(
      'baluarte-vulnerabilidades-2026-10-08.pdf',
    );
  });

  it('entrega o blob ao navegador por um link temporário e revoga a URL', async () => {
    const create = vi.fn(() => 'blob:relatorio');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('r.pdf');
      expect(this.href).toBe('blob:relatorio');
    });
    saveBlob(new Blob(['%PDF-'], { type: 'application/pdf' }), 'r.pdf');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:relatorio'));
    click.mockRestore();
  });
});

describe('PDF simples do modo mock', () => {
  it('é um PDF válido, com acentos em WinAnsi e xref coerente', async () => {
    const blob = simplePdf(['Relatório de remediação — Crítico'], 'Baluarte');
    expect(blob.type).toBe('application/pdf');
    const pdf = await readBlob(blob);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Encoding /WinAnsiEncoding');
    // Acentos do Latin-1 (ó = f3, ç = e7...) e o travessão na posição WinAnsi (97).
    expect(pdf).toContain(`<${hex('Relatório de remediação ')}97${hex(' Crítico')}>`);
    expect(hex('ó')).toBe('f3');
    // Cada entrada da tabela xref aponta para o início do objeto.
    const xrefAt = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('quebra a página e numera "Página X de Y"', async () => {
    const pdf = await readBlob(
      simplePdf(
        Array.from({ length: 80 }, (_, i) => `linha ${i}`),
        'Baluarte',
      ),
    );
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain(hex('Baluarte · Página 1 de 2'));
    expect(pdf).toContain(hex('Baluarte · Página 2 de 2'));
  });
});

describe('mockApi.exportVulnerabilityReport', () => {
  it('Colaborador recebe 403', async () => {
    login('collaborator');
    await expect(mockApi.exportVulnerabilityReport()).rejects.toMatchObject({ status: 403 });
  });

  it('gera o PDF com os filtros da lista e registra a exportação na auditoria', async () => {
    login('analyst');
    const { items, summary } = await mockApi.listVulnerabilities({ severity: 'critical' });
    const report = await mockApi.exportVulnerabilityReport({ severity: 'critical', status: 'all' });
    expect(report.filename).toMatch(/^baluarte-vulnerabilidades-\d{4}-\d{2}-\d{2}\.pdf$/);
    const pdf = await readBlob(report.blob);
    expect(pdf).toContain(hex(`Achados: ${summary.total} `));
    expect(pdf).toContain(hex(items[0].assetHost));

    login('admin');
    const audit = await mockApi.listAuditLog({ action: 'EXPORTAR_RELATORIO_VULNERABILIDADES' });
    expect(audit.items[0].detail).toBe(
      `${summary.total} ${summary.total === 1 ? 'achado' : 'achados'}; severidade: Crítico; status: todos; busca: nenhuma`,
    );
    expect(audit.items[0].user?.email).toBe(MOCK_USERS.find((u) => u.role === 'analyst')!.email);
  });

  it('rótulo da ação na tela de auditoria', () => {
    expect(auditActionLabel('EXPORTAR_RELATORIO_VULNERABILIDADES')).toBe(
      'Relatório de vulnerabilidades exportado',
    );
  });
});

describe('realApi.exportVulnerabilityReport', () => {
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

  it('pede o PDF como blob, com os filtros no formato do backend e o token', async () => {
    const pdf = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
    reply = () => ({
      status: 200,
      data: pdf,
      headers: { 'content-disposition': 'attachment; filename="baluarte-vulnerabilidades-2026-10-08.pdf"' },
    });
    const report = await realApi.exportVulnerabilityReport({
      severity: 'high',
      status: 'in_review',
      query: ' 10.0 ',
    });
    expect(report).toEqual({ blob: pdf, filename: 'baluarte-vulnerabilidades-2026-10-08.pdf' });
    expect(calls[0].url).toBe('/vulnerabilidades/relatorio.pdf');
    expect(calls[0].responseType).toBe('blob');
    expect(calls[0].params).toEqual({ severidade: 'Alto', status: 'Em revisão', q: '10.0' });
    expect(String(calls[0].headers?.Authorization)).toBe('Bearer token-de-teste');
  });

  it('sem filtros não manda parâmetros e, sem Content-Disposition, usa o nome padrão', async () => {
    reply = () => ({ status: 200, data: new Blob(['%PDF-']) });
    const report = await realApi.exportVulnerabilityReport({ severity: 'all', status: 'all', query: '' });
    expect(calls[0].params).toEqual({});
    expect(report.filename).toBe(vulnerabilityReportFilename());
  });

  it('erro em download: lê o envelope JSON de dentro do blob', async () => {
    reply = () => ({
      status: 400,
      data: new Blob(
        [JSON.stringify({ status: 'erro', mensagem: 'Status inválido', codigoErro: 'STATUS_INVALIDO' })],
        {
          type: 'application/json',
        },
      ),
    });
    await expect(realApi.exportVulnerabilityReport({ status: 'open' })).rejects.toMatchObject({
      status: 400,
      code: 'STATUS_INVALIDO',
      message: 'Status inválido',
    });
  });

  it('blob de erro ilegível vira o erro genérico do status', async () => {
    reply = () => ({ status: 500, data: new Blob(['<html>']) });
    const error = await realApi.exportVulnerabilityReport().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 500, code: 'HTTP_500' });
  });

  it('severidade "Informativo" não existe no servidor: recusa sem chamar a API', async () => {
    reply = () => ({ status: 200, data: new Blob([]) });
    await expect(realApi.exportVulnerabilityReport({ severity: 'info' })).rejects.toMatchObject({
      code: 'SEVERIDADE_INVALIDA',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('botão "Exportar PDF" na tela de vulnerabilidades', () => {
  let saved: Array<{ blob: Blob; name: string }>;
  beforeEach(() => {
    saved = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ blob: new Blob(), name: this.download });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('Analista baixa o PDF com os filtros ativos; a exportação vai para a auditoria', async () => {
    const user = userEvent.setup();
    renderPage('analyst');
    const button = await screen.findByRole('button', { name: 'Exportar PDF' });
    await waitFor(() => expect(button).toBeEnabled());

    await user.selectOptions(screen.getByLabelText('Severidade'), 'critical');
    await user.click(button);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toMatch(/^baluarte-vulnerabilidades-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    login('admin');
    const audit = await mockApi.listAuditLog({ action: 'EXPORTAR_RELATORIO_VULNERABILIDADES' });
    expect(audit.items[0].detail).toContain('severidade: Crítico');
  });

  it('mostra "Gerando PDF…" enquanto gera e o erro quando falha', async () => {
    const user = userEvent.setup();
    renderPage('admin');
    const button = await screen.findByRole('button', { name: 'Exportar PDF' });
    await waitFor(() => expect(button).toBeEnabled());

    configureMocks({ latencyMs: [400, 400], failureRate: 1 });
    await user.click(button);
    expect(await screen.findByRole('button', { name: 'Gerando PDF…' })).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('alert')).toHaveTextContent('Serviço temporariamente indisponível');
    expect(screen.getByRole('button', { name: 'Exportar PDF' })).toBeEnabled();
    expect(saved).toHaveLength(0);
  });

  it('sem achados com os filtros atuais, o botão fica desabilitado', async () => {
    const user = userEvent.setup();
    renderPage('analyst');
    const button = await screen.findByRole('button', { name: 'Exportar PDF' });
    await user.type(screen.getByLabelText('Buscar'), 'nada-casa-com-isto');
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('title', 'Nenhuma vulnerabilidade com os filtros atuais');
  });

  it('Colaborador não vê o botão', async () => {
    renderPage('collaborator');
    await screen.findByRole('heading', { name: 'Vulnerabilidades' });
    expect(screen.queryByRole('button', { name: /Exportar PDF/ })).not.toBeInTheDocument();
  });
});
