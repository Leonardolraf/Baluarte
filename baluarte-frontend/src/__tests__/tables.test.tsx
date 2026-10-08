import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Campaign, CampaignFilters, Vulnerability, VulnerabilityFilters } from '@/types';
import { CampaignTable } from '@/components/Table/CampaignTable';
import { VulnTable } from '@/components/Table/VulnTable';
import { MOCK_CAMPAIGNS, MOCK_VULNERABILITIES } from '@/mocks/data';

// Tabelas de vulnerabilidades e de campanhas: ordenação por coluna, filtros
// controlados pela página, linhas clicáveis, estado vazio e esqueleto de carga.

const NO_VULN_FILTERS: VulnerabilityFilters = { severity: 'all', status: 'all', query: '' };
const NO_CAMPAIGN_FILTERS: CampaignFilters = { status: 'all', from: '', to: '', query: '' };

function DetailProbe({ prefix }: { prefix: string }) {
  const { id } = useParams();
  return <p>{`${prefix} ${id}`}</p>;
}

function inRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/vulnerabilities/:id" element={<DetailProbe prefix="detalhe da vulnerabilidade" />} />
        <Route path="/campaigns/:id" element={<DetailProbe prefix="relatório da campanha" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function rowIds(testId: string): string[] {
  return screen.getAllByTestId(testId).map((row) => row.getAttribute('data-id') ?? '');
}

function sortButton(name: string): HTMLElement {
  return within(screen.getByRole('columnheader', { name: new RegExp(name) })).getByRole('button');
}

const vulnById = new Map<string, Vulnerability>(MOCK_VULNERABILITIES.map((v) => [v.id, v]));
const campaignById = new Map<string, Campaign>(MOCK_CAMPAIGNS.map((c) => [c.id, c]));

describe('VulnTable', () => {
  const items = MOCK_VULNERABILITIES.slice(0, 8);

  it('ordena por CVSS (asc → desc → sem ordenação) e marca aria-sort', async () => {
    const user = userEvent.setup();
    inRouter(<VulnTable items={items} filters={NO_VULN_FILTERS} onFiltersChange={vi.fn()} pageSize={50} />);
    const cvssOf = () => rowIds('vuln-row').map((id) => vulnById.get(id)!.cvss.base);

    await user.click(sortButton('CVSS'));
    expect(screen.getByRole('columnheader', { name: /CVSS/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(cvssOf()).toEqual([...cvssOf()].sort((a, b) => a - b));

    await user.click(sortButton('CVSS'));
    expect(screen.getByRole('columnheader', { name: /CVSS/ })).toHaveAttribute('aria-sort', 'descending');
    expect(cvssOf()).toEqual([...cvssOf()].sort((a, b) => b - a));

    await user.click(sortButton('CVSS'));
    expect(rowIds('vuln-row')).toEqual(items.map((v) => v.id));
  });

  it('ordena por título e por data de detecção', async () => {
    const user = userEvent.setup();
    inRouter(<VulnTable items={items} filters={NO_VULN_FILTERS} onFiltersChange={vi.fn()} pageSize={50} />);

    await user.click(sortButton('Título'));
    const titles = rowIds('vuln-row').map((id) => vulnById.get(id)!.title);
    expect(titles).toEqual(
      [...titles].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })),
    );

    await user.click(sortButton('Detectado em'));
    const times = rowIds('vuln-row').map((id) => new Date(vulnById.get(id)!.detectedAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    await user.click(sortButton('Severidade'));
    expect(screen.getByRole('columnheader', { name: /Severidade/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('repassa busca, severidade e status para a página e limpa os filtros', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const { rerender } = inRouter(
      <VulnTable items={items} filters={NO_VULN_FILTERS} onFiltersChange={onFiltersChange} />,
    );
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'sql' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_VULN_FILTERS, query: 'sql' });

    await user.selectOptions(screen.getByLabelText('Severidade'), 'critical');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_VULN_FILTERS, severity: 'critical' });

    await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_VULN_FILTERS, status: 'resolved' });

    const active: VulnerabilityFilters = { ...NO_VULN_FILTERS, severity: 'high' };
    rerender(
      <MemoryRouter>
        <VulnTable items={items} filters={active} onFiltersChange={onFiltersChange} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_VULN_FILTERS);
  });

  it('sem resultados com filtro ativo oferece "Limpar filtros"', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    inRouter(
      <VulnTable
        items={[]}
        filters={{ ...NO_VULN_FILTERS, query: 'inexistente' }}
        onFiltersChange={onFiltersChange}
      />,
    );
    expect(screen.getByText('Nenhuma vulnerabilidade encontrada.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onFiltersChange).toHaveBeenCalledWith(NO_VULN_FILTERS);
  });

  it('carregando sem itens mostra esqueleto e aviso para leitor de tela', () => {
    inRouter(
      <VulnTable items={[]} loading filters={NO_VULN_FILTERS} onFiltersChange={vi.fn()} hideFilters />,
    );
    expect(screen.getByTestId('vuln-table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Carregando vulnerabilidades…');
    expect(screen.queryByTestId('vuln-row')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar')).not.toBeInTheDocument();
  });

  it('clicar na linha abre o detalhe ou chama onRowClick', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const { unmount } = inRouter(
      <VulnTable items={items} filters={NO_VULN_FILTERS} onFiltersChange={vi.fn()} onRowClick={onRowClick} />,
    );
    await user.click(screen.getAllByTestId('vuln-row')[0]!.querySelector('td')!);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: rowIds('vuln-row')[0] }));
    unmount();

    inRouter(<VulnTable items={items} filters={NO_VULN_FILTERS} onFiltersChange={vi.fn()} />);
    const firstId = rowIds('vuln-row')[0];
    await user.click(screen.getAllByTestId('vuln-row')[0]!.querySelector('td')!);
    expect(screen.getByText(`detalhe da vulnerabilidade ${firstId}`)).toBeInTheDocument();
  });
});

describe('CampaignTable', () => {
  const items = MOCK_CAMPAIGNS;

  it('começa pela data mais recente e ordena pelas demais colunas', async () => {
    const user = userEvent.setup();
    inRouter(
      <CampaignTable items={items} filters={NO_CAMPAIGN_FILTERS} onFiltersChange={vi.fn()} pageSize={50} />,
    );
    const times = () =>
      rowIds('campaign-row').map((id) => new Date(campaignById.get(id)!.scheduledAt).getTime());
    expect(times()).toEqual([...times()].sort((a, b) => b - a));

    await user.click(sortButton('Enviados'));
    const sent = rowIds('campaign-row').map((id) => campaignById.get(id)!.metrics.sent);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));

    await user.click(sortButton('Nome'));
    const names = rowIds('campaign-row').map((id) => campaignById.get(id)!.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })),
    );

    // Taxas sem envio (null) ficam no fim, em qualquer direção.
    for (const column of ['Clicados', 'Abertos', 'Treinados', 'Status']) {
      await user.click(sortButton(column));
      expect(screen.getByRole('columnheader', { name: new RegExp(column) })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
    }
    await user.click(sortButton('Clicados'));
    await user.click(sortButton('Clicados'));
    const clickRates = rowIds('campaign-row')
      .map((id) => campaignById.get(id)!)
      .map((c) => (c.metrics.sent > 0 ? c.metrics.clickRate : null));
    const measured = clickRates.filter((r): r is number => r !== null);
    expect(measured).toEqual([...measured].sort((a, b) => b - a));
    expect(clickRates.slice(measured.length).every((r) => r === null)).toBe(true);
  });

  it('repassa busca, status e período para a página', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    inRouter(<CampaignTable items={items} filters={NO_CAMPAIGN_FILTERS} onFiltersChange={onFiltersChange} />);

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'financeiro' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_CAMPAIGN_FILTERS, query: 'financeiro' });

    await user.selectOptions(screen.getByLabelText('Status'), 'active');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_CAMPAIGN_FILTERS, status: 'active' });

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-09-01' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_CAMPAIGN_FILTERS, from: '2026-09-01' });

    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-09-30' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_CAMPAIGN_FILTERS, to: '2026-09-30' });
  });

  it('com filtro ativo: "Limpar" e "Limpar filtros" voltam ao estado inicial', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    inRouter(
      <CampaignTable
        items={[]}
        filters={{ ...NO_CAMPAIGN_FILTERS, from: '2026-01-01' }}
        onFiltersChange={onFiltersChange}
        emptyMessage="Sem campanhas no período."
      />,
    );
    expect(screen.getByText('Sem campanhas no período.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onFiltersChange.mock.calls).toEqual([[NO_CAMPAIGN_FILTERS], [NO_CAMPAIGN_FILTERS]]);
  });

  it('esqueleto durante a primeira carga', () => {
    inRouter(
      <CampaignTable
        items={[]}
        loading
        filters={NO_CAMPAIGN_FILTERS}
        onFiltersChange={vi.fn()}
        hideFilters
      />,
    );
    expect(screen.getByTestId('campaign-table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Carregando campanhas…');
    expect(screen.queryByTestId('campaign-row')).not.toBeInTheDocument();
  });

  it('clicar na linha abre o relatório ou chama onRowClick', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const { unmount } = inRouter(
      <CampaignTable
        items={items}
        filters={NO_CAMPAIGN_FILTERS}
        onFiltersChange={vi.fn()}
        onRowClick={onRowClick}
      />,
    );
    await user.click(screen.getAllByTestId('campaign-row')[0]!.querySelectorAll('td')[1]!);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: rowIds('campaign-row')[0] }));
    unmount();

    inRouter(<CampaignTable items={items} filters={NO_CAMPAIGN_FILTERS} onFiltersChange={vi.fn()} />);
    const firstId = rowIds('campaign-row')[0];
    await user.click(screen.getAllByTestId('campaign-row')[0]!.querySelectorAll('td')[1]!);
    expect(screen.getByText(`relatório da campanha ${firstId}`)).toBeInTheDocument();
  });

  it('pagina quando há mais campanhas que o tamanho da página', async () => {
    const user = userEvent.setup();
    inRouter(
      <CampaignTable items={items} filters={NO_CAMPAIGN_FILTERS} onFiltersChange={vi.fn()} pageSize={2} />,
    );
    expect(screen.getAllByTestId('campaign-row')).toHaveLength(2);
    const firstPage = rowIds('campaign-row');
    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    await user.click(within(nav).getByRole('button', { name: /próxima/i }));
    expect(rowIds('campaign-row')).not.toEqual(firstPage);
  });
});
