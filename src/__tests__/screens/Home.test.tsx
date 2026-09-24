import { fireEvent, screen } from '@testing-library/react-native';
import { ADMIN, ANALYST, freezeDate, renderApp } from '../../test-utils';

function listedCampaignIds() {
  return screen.getAllByTestId(/^campaign-item-/).map((item) => item.props.testID as string);
}

describe('Home', () => {
  beforeEach(() => freezeDate());

  it('mostra saudação, perfil e as 5 campanhas mais recentes primeiro', async () => {
    await renderApp({ user: ADMIN });

    expect(screen.getByText('Olá, Leonardo')).toBeOnTheScreen();
    expect(screen.getByText('Administrador · Diretoria')).toBeOnTheScreen();
    expect(screen.getByText('Total 5')).toBeOnTheScreen();
    expect(listedCampaignIds()).toEqual([
      'campaign-item-camp-005',
      'campaign-item-camp-001',
      'campaign-item-camp-004',
      'campaign-item-camp-002',
      'campaign-item-camp-003',
    ]);
    expect(screen.getByText('18/10 às 09:00h')).toBeOnTheScreen();
  });

  it('o analista vê o próprio perfil', async () => {
    await renderApp({ user: ANALYST });
    expect(screen.getByText('Olá, Rafael')).toBeOnTheScreen();
    expect(screen.getByText('Analista · TI')).toBeOnTheScreen();
  });

  it('filtro por modelo altera a lista e o Total; tocar de novo limpa', async () => {
    await renderApp({ user: ADMIN });

    await fireEvent.press(screen.getByRole('button', { name: 'Urgência' }));
    expect(screen.getByText('Total 2')).toBeOnTheScreen();
    expect(listedCampaignIds()).toEqual(['campaign-item-camp-001', 'campaign-item-camp-002']);
    expect(screen.queryByText('Fake Invoice Julho')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Curiosidade' }));
    expect(screen.getByText('Total 1')).toBeOnTheScreen();
    expect(screen.getByText('Fake Invoice Julho')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Curiosidade' }));
    expect(screen.getByText('Total 5')).toBeOnTheScreen();
  });

  it('mostra Total 6 depois de agendar uma campanha', async () => {
    await renderApp({ user: ADMIN });

    await fireEvent.press(screen.getByRole('button', { name: 'Nova campanha' }));
    await fireEvent.changeText(screen.getByLabelText('Nome da campanha'), 'Simulação Q4 – Financeiro');
    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));

    // Detalhes substituiu a Nova campanha: voltar leva direto à Home.
    await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));

    expect(await screen.findByText('Total 6')).toBeOnTheScreen();
    expect(listedCampaignIds()[1]).toBe('campaign-item-camp-006');
    expect(screen.getByText('Simulação Q4 – Financeiro')).toBeOnTheScreen();
  });

  it('tocar numa campanha abre os Detalhes dela', async () => {
    await renderApp({ user: ADMIN });

    await fireEvent.press(screen.getByTestId('campaign-item-camp-004'));

    expect(await screen.findByText('Detalhes')).toBeOnTheScreen();
    expect(screen.getByText('Gabriela Gonçalves')).toBeOnTheScreen();
  });

  it('o avatar pede confirmação e sai da conta', async () => {
    await renderApp({ user: ADMIN });

    await fireEvent.press(screen.getByRole('button', { name: /Sair da conta/ }));
    expect(screen.getByText('Deseja sair do Baluarte?')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Sim, sair' }));
    expect(await screen.findByText('Entrar no Baluarte')).toBeOnTheScreen();
  });

  it('"Não" fecha a confirmação e mantém a sessão', async () => {
    await renderApp({ user: ADMIN });

    await fireEvent.press(screen.getByRole('button', { name: /Sair da conta/ }));
    await fireEvent.press(screen.getByText('Não'));

    expect(screen.queryByText('Deseja sair do Baluarte?')).not.toBeOnTheScreen();
    expect(screen.getByText('Olá, Leonardo')).toBeOnTheScreen();
    expect(screen.queryByText('Entrar no Baluarte')).not.toBeOnTheScreen();
  });
});
