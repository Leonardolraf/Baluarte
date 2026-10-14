import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Asset, AuthUser, Vulnerability, VulnerabilityFilters } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { mockApi } from '@/mocks/api';
import { MOCK_ASSETS, MOCK_USERS, MOCK_VULNERABILITIES } from '@/mocks/data';
import { VulnTable } from '@/components/Table/VulnTable';
import AssetListPage from '@/pages/Assets/AssetListPage';
import VulnDetailPage from '@/pages/Vulnerabilities/VulnDetailPage';

// XSS armazenado no frontend (cartão #13 da lista "Melhorias"). A API devolve o texto do
// usuário literal, em JSON (backend/tests/seguranca/xss-armazenado.test.ts); quem impede o
// payload de virar código é o React, que escapa todo texto interpolado em JSX. Estes testes
// desenham um ativo e uma vulnerabilidade com payloads e provam que nenhum <script>, atributo
// on* ou link javascript: vira DOM, e que o código não usa dangerouslySetInnerHTML nem outra
// API que injete HTML cru.

const P = {
  script: '<script>window.__xss = 1</script>',
  img: '"><img src=x onerror="window.__xss = 2">',
  svg: '<svg/onload="window.__xss = 3">',
  iframe: "</p><iframe srcdoc='<script>window.__xss = 4</script>'></iframe>",
  url: 'javascript:window.__xss=5',
};

/** O DOM desenhado não ganhou nada executável a partir do texto. */
function semNadaExecutavel(raiz: HTMLElement) {
  expect(raiz.querySelectorAll('script, iframe, object, embed')).toHaveLength(0);
  expect(raiz.querySelectorAll('img[src="x"]')).toHaveLength(0);
  for (const el of raiz.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      expect(attr.name, `atributo ${attr.name} em <${el.tagName.toLowerCase()}>`).not.toMatch(/^on/i);
      if (attr.name === 'href' || attr.name === 'src') expect(attr.value).not.toMatch(/^\s*javascript:/i);
    }
  }
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
}

function sessaoAnalista() {
  const found = MOCK_USERS.find((u) => u.id === 'u-001')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return { status: 'authenticated' as const, token, user };
}

const ativoMalicioso: Asset = {
  ...MOCK_ASSETS[0]!,
  id: 'asset-xss',
  name: P.script,
  host: 'xss.empresa.com',
  description: `${P.img} ${P.svg}`,
  openFindings: 2,
};

const vulnMaliciosa: Vulnerability = {
  ...MOCK_VULNERABILITIES[0]!,
  id: 'vuln-xss',
  title: P.img,
  assetName: P.script,
  affectedComponent: P.svg,
  description: `${P.iframe}\n\n${P.script}`,
  evidence: [
    {
      id: 'ev-xss',
      kind: 'response',
      label: P.svg,
      content: P.iframe,
      capturedAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  remediation: [{ order: 1, title: P.script, description: P.img, effort: 'low' }],
  references: [P.url, 'https://owasp.org/Top10/'],
  history: [{ id: 'h-xss', at: '2026-10-01T10:00:00.000Z', action: 'detected', note: P.svg }],
};

describe('XSS armazenado: o React escapa o texto do usuário', () => {
  it('lista de ativos: nome com <script> aparece como texto, sem virar elemento', async () => {
    vi.spyOn(mockApi, 'listAssets').mockResolvedValue([ativoMalicioso]);
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { container } = render(
      <MemoryRouter>
        <AuthProvider initialSession={sessaoAnalista()} revalidateOnMount={false}>
          <AssetListPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(P.script)).toBeInTheDocument();
    semNadaExecutavel(container);
    expect(alerta).not.toHaveBeenCalled();
  });

  it('tabela de vulnerabilidades: título e ativo com payload ficam texto', () => {
    const filtros: VulnerabilityFilters = { severity: 'all', status: 'all', query: '' };
    const { container } = render(
      <MemoryRouter>
        <VulnTable items={[vulnMaliciosa]} filters={filtros} onFiltersChange={vi.fn()} pageSize={10} />
      </MemoryRouter>,
    );
    expect(screen.getByText(P.img)).toBeInTheDocument();
    expect(container.textContent).toContain(P.script);
    semNadaExecutavel(container);
  });

  it('detalhe da vulnerabilidade: visão geral, evidências, remediação e histórico com payload ficam texto', async () => {
    vi.spyOn(mockApi, 'getVulnerability').mockResolvedValue(vulnMaliciosa);
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/vulnerabilities/vuln-xss']}>
        <AuthProvider initialSession={sessaoAnalista()} revalidateOnMount={false}>
          <Routes>
            <Route path="/vulnerabilities/:id" element={<VulnDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findAllByText(P.img)).not.toHaveLength(0);
    expect(container.textContent).toContain(P.iframe);
    // A referência javascript: aparece como texto, nunca como link; a https vira link.
    expect(screen.getByText(P.url).closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: /owasp\.org/ })).toHaveAttribute(
      'href',
      'https://owasp.org/Top10/',
    );
    semNadaExecutavel(container);

    for (const aba of [/Evidências/, /Remediação/, /Histórico/]) {
      await user.click(screen.getByRole('tab', { name: aba }));
      semNadaExecutavel(container);
    }
    expect(container.textContent).toContain(P.svg);
  });
});

// -----------------------------------------------------------------------------
// Varredura do código-fonte: nenhuma API que injete HTML cru. Resultado do grep registrado em
// testes/qualidade/metodos-verificacao.md (zero ocorrências em src/ fora deste arquivo).
// O Vitest roda na raiz do baluarte-frontend (no jsdom, import.meta.url não é file:).
const SRC = join(process.cwd(), 'src');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

describe('nenhuma injeção de HTML cru no código', () => {
  it('src/ não usa dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write nem eval', () => {
    const proibido =
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|(?<![.\w])eval\s*\(|new Function\s*\(/;
    const este = join(SRC, '__tests__', 'xss.test.tsx');
    const lista = arquivos(SRC);
    expect(lista.length).toBeGreaterThan(50);
    const achados = lista
      .filter((arquivo) => arquivo !== este)
      .flatMap((arquivo) =>
        readFileSync(arquivo, 'utf8')
          .split('\n')
          .map((linha, i) => (proibido.test(linha) ? `${relative(SRC, arquivo)}:${i + 1}` : null))
          .filter((x): x is string => x !== null),
      );
    expect(achados).toEqual([]);
  });
});
