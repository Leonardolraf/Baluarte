import { fireEvent, screen } from '@testing-library/react-native';
import { renderApp } from '../../test-utils';

async function fillAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('E-mail'), email);
  await fireEvent.changeText(screen.getByLabelText('Senha'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

describe('Login', () => {
  it('mostra a tela com o e-mail do administrador já preenchido', async () => {
    await renderApp();

    expect(screen.getByText('Entrar no Baluarte')).toBeOnTheScreen();
    expect(screen.getByText('PLATAFORMA DE CIBERSEGURANÇA')).toBeOnTheScreen();
    expect(screen.getByLabelText('E-mail')).toHaveDisplayValue('admin@empresa.com');
    expect(screen.getByLabelText('Senha')).toHaveDisplayValue('');
    expect(screen.getByText('Perfis: Administrador · Analista · Colaborador')).toBeOnTheScreen();
  });

  it('valida e-mail e senha obrigatórios', async () => {
    await renderApp();

    await fillAndSubmit('', '');

    expect(screen.getByText('E-mail é obrigatório')).toBeOnTheScreen();
    expect(screen.getByText('Senha é obrigatória')).toBeOnTheScreen();
  });

  it('valida o formato do e-mail e o tamanho mínimo da senha', async () => {
    await renderApp();

    await fillAndSubmit('admin@empresa', '123');

    expect(screen.getByText('Formato de e-mail inválido')).toBeOnTheScreen();
    expect(screen.getByText('A senha deve ter ao menos 6 caracteres.')).toBeOnTheScreen();
  });

  it('recusa e-mail fora das contas de demonstração', async () => {
    await renderApp();

    await fillAndSubmit('intruso@empresa.com', 'senha-forte');

    expect(screen.getByText('E-mail ou senha inválidos.')).toBeOnTheScreen();
    expect(screen.queryByText('Campanhas')).not.toBeOnTheScreen();
  });

  it('bloqueia o perfil Colaborador (RBAC)', async () => {
    await renderApp();

    await fillAndSubmit('colaborador@empresa.com', 'senha-forte');

    expect(
      screen.getByText('O perfil Colaborador não tem acesso às campanhas neste app.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Campanhas')).not.toBeOnTheScreen();
  });

  it('administrador com senha válida entra na Home', async () => {
    await renderApp();

    await fillAndSubmit('admin@empresa.com', 'qualquer-senha');

    expect(await screen.findByText('Olá, Leonardo')).toBeOnTheScreen();
    expect(screen.getByText('Administrador · Diretoria')).toBeOnTheScreen();
    expect(screen.getByText('Campanhas')).toBeOnTheScreen();
  });

  it('analista também entra (campanhas são de Administrador e Analista)', async () => {
    await renderApp();

    await fillAndSubmit('ANALISTA@empresa.com ', 'qualquer-senha');

    expect(await screen.findByText('Olá, Rafael')).toBeOnTheScreen();
    expect(screen.getByText('Analista · TI')).toBeOnTheScreen();
  });

  it('o olho mostra e oculta a senha', async () => {
    await renderApp();
    const password = screen.getByLabelText('Senha');

    expect(password).toHaveProp('secureTextEntry', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(screen.getByLabelText('Senha')).toHaveProp('secureTextEntry', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(screen.getByLabelText('Senha')).toHaveProp('secureTextEntry', true);
  });
});
