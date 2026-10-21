import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders } from '../../contexts';
import { AppRoutes } from '../../routes/app.routes';
import { ADMIN, renderApp, TEST_METRICS, testCampaigns } from '../../test-utils';

async function openCampaign(id: string) {
  await renderApp({ user: ADMIN });
  await fireEvent.press(screen.getByTestId(`campaign-item-${id}`));
}

describe('Detalhes da campanha', () => {
  it('agendada: KPIs de destinatários/enviados/"—" e o aviso de não disparada', async () => {
    await openCampaign('camp-005');

    const banner = screen.getByTestId('campaign-banner');
    expect(within(banner).getByText('Diretoria – Autoridade Q4')).toBeOnTheScreen();
    expect(within(banner).getByText('Agendada')).toBeOnTheScreen();
    expect(within(banner).getByText('Agendada para 18/10/2026 09:00')).toBeOnTheScreen();
    expect(within(banner).getByText('DESTINATÁRIOS')).toBeOnTheScreen();
    expect(within(banner).getByText('ENVIADOS')).toBeOnTheScreen();
    expect(within(banner).getByText('—')).toBeOnTheScreen();

    const recipients = screen.getByTestId('recipients');
    expect(within(recipients).getByText('Total 24')).toBeOnTheScreen();
    expect(within(recipients).getByText('Patrícia Pereira')).toBeOnTheScreen();
    expect(within(recipients).getAllByText('Não recebeu')).toHaveLength(3);
    expect(
      within(recipients).getByText('Campanha ainda não disparada — as etapas aparecem depois do envio.'),
    ).toBeOnTheScreen();
  });

  it('ativa: enviados, taxa de clique 24%, reportaram e as etapas coloridas', async () => {
    await openCampaign('camp-001');

    const banner = screen.getByTestId('campaign-banner');
    expect(within(banner).getByText('Ativa')).toBeOnTheScreen();
    expect(within(banner).getByLabelText('156 enviados')).toBeOnTheScreen();
    expect(within(banner).getByLabelText('Taxa de clique: 24%')).toBeOnTheScreen();
    expect(within(banner).getByLabelText('30 reportaram')).toBeOnTheScreen();
    expect(within(banner).getByText('Financeiro')).toBeOnTheScreen();
    expect(within(banner).getByText('Urgência')).toBeOnTheScreen();

    const recipients = screen.getByTestId('recipients');
    expect(within(recipients).getByText('Total 156')).toBeOnTheScreen();
    expect(within(recipients).getByText('Reportou')).toBeOnTheScreen();
    expect(within(recipients).getByText('Clicou')).toBeOnTheScreen();
    expect(within(recipients).getByText('Submeteu credenciais')).toBeOnTheScreen();
    expect(within(recipients).queryByText(/Campanha ainda não disparada/)).not.toBeOnTheScreen();
  });

  it('encerrada: status e taxa de clique de junho (31%)', async () => {
    await openCampaign('camp-002');

    const banner = screen.getByTestId('campaign-banner');
    expect(within(banner).getByText('Encerrada')).toBeOnTheScreen();
    expect(within(banner).getByText('31%')).toBeOnTheScreen();
    expect(within(banner).getByText('Toda a empresa')).toBeOnTheScreen();
  });

  it('abre o treinamento do modelo da campanha', async () => {
    await openCampaign('camp-003');

    await fireEvent.press(screen.getByRole('button', { name: 'Ver material de treinamento' }));

    expect(await screen.findByText('Golpes que usam autoridade')).toBeOnTheScreen();
    expect(screen.getByText('US-006')).toBeOnTheScreen();
  });

  it('campanha inexistente: avisa e volta para a lista', async () => {
    // Pilha montada à mão (Home → Detalhes de um id que não existe).
    await render(
      <SafeAreaProvider initialMetrics={TEST_METRICS}>
        <AppProviders initialUser={ADMIN} initialCampaigns={testCampaigns()}>
          <NavigationContainer
            initialState={{
              index: 1,
              routes: [{ name: 'Home' }, { name: 'CampaignDetails', params: { campaignId: 'camp-999' } }],
            }}
          >
            <AppRoutes />
          </NavigationContainer>
        </AppProviders>
      </SafeAreaProvider>,
    );

    expect(screen.getByText('Campanha não encontrada')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Voltar para campanhas' }));

    expect(await screen.findByText('Olá, Leonardo')).toBeOnTheScreen();
    expect(screen.queryByText('Campanha não encontrada')).not.toBeOnTheScreen();
  });
});
