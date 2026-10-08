import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { HttpError } from '@/lib/errors';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { mockApi } from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';
import { api } from '@/services/api';
import AssetFormPage from '@/pages/Assets/AssetFormPage';

// Cadastro de ativo: validação no cliente (nome, tipo, host DNS/IPv4, IP opcional),
// envio para a API, erro da API apontado no campo certo e erro genérico em banner.

function renderAsAnalyst() {
  const found = MOCK_USERS.find((u) => u.id === 'u-001')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return render(
    <MemoryRouter initialEntries={['/assets/new']}>
      <AuthProvider initialSession={{ status: 'authenticated', token, user }} revalidateOnMount={false}>
        <Routes>
          <Route path="/assets/new" element={<AssetFormPage />} />
          <Route path="/vulnerabilities" element={<p>Lista de vulnerabilidades</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const field = {
  name: () => screen.getByLabelText(/^Nome/),
  type: () => screen.getByLabelText(/^Tipo/),
  host: () => screen.getByLabelText(/^Host/),
  ip: () => screen.getByLabelText(/^Endereço IP/),
  description: () => screen.getByLabelText(/^Descrição/),
};

describe('AssetFormPage', () => {
  it('mostra os erros de validação e não chama a API com o formulário vazio', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, 'createAsset');
    renderAsAnalyst();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe o nome do ativo.')).toBeInTheDocument();
    expect(screen.getByText('Selecione o tipo do ativo.')).toBeInTheDocument();
    expect(screen.getByText('Informe o host do ativo.')).toBeInTheDocument();
    expect(field.name()).toHaveAttribute('aria-invalid', 'true');
    expect(spy).not.toHaveBeenCalled();
  });

  it('valida tamanho do nome, formato do host e do IP', async () => {
    const user = userEvent.setup();
    renderAsAnalyst();

    await user.type(field.name(), 'ab');
    await user.type(field.host(), 'sem-ponto');
    await user.type(field.ip(), '300.1.1.1');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('O nome deve ter ao menos 3 caracteres.')).toBeInTheDocument();
    expect(screen.getByText(/Informe um nome DNS válido/)).toBeInTheDocument();
    expect(screen.getByText(/Informe um endereço IPv4 válido/)).toBeInTheDocument();

    await user.clear(field.name());
    await user.type(field.name(), 'x'.repeat(81));
    await user.clear(field.host());
    await user.type(field.host(), '-web.empresa.com');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('O nome deve ter no máximo 80 caracteres.')).toBeInTheDocument();
    expect(screen.getByText(/Informe um nome DNS válido/)).toBeInTheDocument();
  });

  it('cadastra o ativo com os campos aparados e volta para a lista', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(mockApi, 'createAsset');
    renderAsAnalyst();

    await user.type(field.name(), '  Servidor de Testes  ');
    await user.selectOptions(field.type(), 'database');
    await user.type(field.host(), ' db-teste.empresa.com ');
    await user.type(field.ip(), '192.168.0.10');
    await user.type(field.description(), '  Banco de homologação ');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Lista de vulnerabilidades')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({
      name: 'Servidor de Testes',
      type: 'database',
      host: 'db-teste.empresa.com',
      ip: '192.168.0.10',
      description: 'Banco de homologação',
    });
    const assets = await api.listAssets();
    expect(assets.some((a) => a.host === 'db-teste.empresa.com')).toBe(true);
  });

  it('host duplicado volta da API e aparece no próprio campo', async () => {
    const user = userEvent.setup();
    renderAsAnalyst();

    await user.type(field.name(), 'Web de novo');
    await user.selectOptions(field.type(), 'server');
    await user.type(field.host(), 'srv-web-01.empresa.com');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Ativo já cadastrado')).toBeInTheDocument();
    expect(field.host()).toHaveAttribute('aria-invalid', 'true');
    expect(field.host()).toHaveFocus();
  });

  it('erro sem campo associado aparece no banner do formulário', async () => {
    const user = userEvent.setup();
    vi.spyOn(mockApi, 'createAsset').mockRejectedValueOnce(
      new HttpError(503, 'INDISPONIVEL', 'API fora do ar'),
    );
    renderAsAnalyst();

    await user.type(field.name(), 'Gateway');
    await user.selectOptions(field.type(), 'network');
    await user.type(field.host(), '10.0.0.1');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('API fora do ar');
    expect(screen.queryByText('Lista de vulnerabilidades')).not.toBeInTheDocument();
  });
});
