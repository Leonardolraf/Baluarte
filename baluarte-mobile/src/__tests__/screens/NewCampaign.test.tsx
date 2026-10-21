import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { TOAST_DURATION_MS } from '../../contexts';
import { ADMIN, freezeDate, renderApp, TEST_NOW } from '../../test-utils';

async function openNewCampaign() {
  await renderApp({ user: ADMIN });
  await fireEvent.press(screen.getByRole('button', { name: 'Nova campanha' }));
}

describe('Nova campanha', () => {
  beforeEach(() => freezeDate());

  it('abre com data/hora = hoje + 7 às 09:00, Financeiro e os 3 destinatários de exemplo', async () => {
    await openNewCampaign();

    // Hoje (congelado) = 23/09/2026 -> 30/09 às 09:00, como na captura de referência.
    expect(screen.getByLabelText('Dia')).toHaveDisplayValue('30');
    expect(screen.getByLabelText('Mês')).toHaveDisplayValue('09');
    expect(screen.getByLabelText('Hora')).toHaveDisplayValue('09');
    expect(screen.getByLabelText('Minuto')).toHaveDisplayValue('00');
    expect(screen.getByRole('button', { name: 'Grupo-alvo: Financeiro' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Destinatários')).toHaveDisplayValue(
      'ana.almeida@empresa.com\nbruno.barbosa@empresa.com\ncarla.cardoso@empresa.com',
    );
    expect(screen.getByLabelText('Nome da campanha')).toHaveDisplayValue('');
    expect(screen.getByText('Selecione um modelo.')).toBeOnTheScreen();
    expect(screen.getByText('A campanha dispara automaticamente na data e hora informadas.')).toBeOnTheScreen();
  });

  it('a descrição acompanha o modelo selecionado', async () => {
    await openNewCampaign();

    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    expect(
      screen.getByText('Pressão por ação imediata: "sua conta será bloqueada em 24h".'),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('radio', { name: 'Autoridade' }));
    expect(
      screen.getByText('Solicitação vinda de um "diretor" ou de "TI": "atualize sua senha agora".'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Autoridade' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Urgência' })).not.toBeChecked();
  });

  it('valida nome, modelo e datas inexistentes', async () => {
    await openNewCampaign();

    // Antes de enviar, "Selecione um modelo." é só a dica do campo, não um erro.
    expect(screen.getByText('Selecione um modelo.')).toBeOnTheScreen();
    expect(screen.queryByRole('alert', { name: 'Selecione um modelo.' })).not.toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Nome da campanha'), 'Q4');
    await fireEvent.changeText(screen.getByLabelText('Dia'), '31');
    await fireEvent.changeText(screen.getByLabelText('Mês'), '02');
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));

    // Os erros saem como alerta (accessibilityRole="alert"): prova que cada validação disparou.
    expect(screen.getByRole('alert', { name: 'O nome deve ter ao menos 3 caracteres.' })).toBeOnTheScreen();
    expect(screen.getByRole('alert', { name: 'Selecione um modelo.' })).toBeOnTheScreen();
    expect(screen.getByRole('alert', { name: 'Informe uma data e hora válidas.' })).toBeOnTheScreen();
    expect(screen.queryByText('Campanha agendada com sucesso')).not.toBeOnTheScreen();

    // Escolher um modelo limpa o erro dele e a dica volta a ser a descrição do modelo.
    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    expect(screen.queryByRole('alert', { name: 'Selecione um modelo.' })).not.toBeOnTheScreen();
  });

  it('recusa data no passado', async () => {
    await openNewCampaign();

    await fireEvent.changeText(screen.getByLabelText('Nome da campanha'), 'Campanha antiga');
    await fireEvent.press(screen.getByRole('radio', { name: 'Curiosidade' }));
    await fireEvent.changeText(screen.getByLabelText('Dia'), '22');
    await fireEvent.changeText(screen.getByLabelText('Mês'), '09');
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));

    expect(screen.getByText('Informe uma data e hora futuras.')).toBeOnTheScreen();
  });

  it('destinatário externo gera o erro "Somente destinatários @empresa.com: …"', async () => {
    await openNewCampaign();

    await fireEvent.changeText(screen.getByLabelText('Nome da campanha'), 'Simulação Q4 – Financeiro');
    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    await fireEvent.changeText(
      screen.getByLabelText('Destinatários'),
      'ana.almeida@empresa.com, atacante@gmail.com',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));

    expect(screen.getByText('Somente destinatários @empresa.com: atacante@gmail.com')).toBeOnTheScreen();
    expect(screen.queryByText('Campanha agendada com sucesso')).not.toBeOnTheScreen();
  });

  it('e-mail malformado gera "E-mail inválido: …"', async () => {
    await openNewCampaign();

    await fireEvent.changeText(screen.getByLabelText('Destinatários'), 'ana.almeida@empresa.com\nbruno');
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));

    expect(screen.getByText('E-mail inválido: bruno')).toBeOnTheScreen();
  });

  it('sucesso: cria a campanha, mostra o toast e abre os Detalhes com status Agendada', async () => {
    jest.useFakeTimers({ now: TEST_NOW });
    await openNewCampaign();

    await fireEvent.changeText(screen.getByLabelText('Nome da campanha'), 'Simulação Q4 – Financeiro');
    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));

    // Toast visível logo após agendar, logo abaixo do cabeçalho dos Detalhes:
    // área segura (44) + cabeçalho (60) + 12.
    expect(screen.getByText('Campanha agendada com sucesso')).toBeOnTheScreen();
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 116 });

    // Detalhes da campanha nova (a Nova campanha saiu da pilha).
    expect(screen.getByText('Detalhes')).toBeOnTheScreen();
    expect(screen.queryByText('Nome da campanha')).not.toBeOnTheScreen();

    const banner = screen.getByTestId('campaign-banner');
    expect(within(banner).getByText('Simulação Q4 – Financeiro')).toBeOnTheScreen();
    expect(within(banner).getByText('Agendada')).toBeOnTheScreen();
    expect(within(banner).getByText('Agendada para 30/09/2026 09:00')).toBeOnTheScreen();
    expect(within(banner).getByLabelText('3 destinatários')).toBeOnTheScreen();
    expect(within(banner).getByLabelText('0 enviados')).toBeOnTheScreen();
    expect(within(banner).getByLabelText('Taxa de clique: sem envios')).toBeOnTheScreen();

    const recipients = screen.getByTestId('recipients');
    expect(within(recipients).getByText('Total 3')).toBeOnTheScreen();
    expect(within(recipients).getByText('Ana Almeida')).toBeOnTheScreen();
    expect(within(recipients).getByText('Bruno Barbosa')).toBeOnTheScreen();
    expect(within(recipients).getByText('Carla Cardoso')).toBeOnTheScreen();
    expect(within(recipients).getAllByText('Não recebeu')).toHaveLength(3);
    expect(
      within(recipients).getByText('Campanha ainda não disparada — as etapas aparecem depois do envio.'),
    ).toBeOnTheScreen();

    // O toast some sozinho em ~2,5 s.
    await act(async () => {
      jest.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByText('Campanha agendada com sucesso')).not.toBeOnTheScreen();
  });

  it('voltar à Home antes de o toast sumir: ele fica logo abaixo da saudação (a Home informa a altura dela)', async () => {
    jest.useFakeTimers({ now: TEST_NOW });
    await openNewCampaign();

    await fireEvent.changeText(screen.getByLabelText('Nome da campanha'), 'Simulação Q4 – Financeiro');
    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Agendar campanha' }));
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 116 });

    await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));

    expect(screen.getByText('Total 6')).toBeOnTheScreen();
    expect(screen.getByText('Campanha agendada com sucesso')).toBeOnTheScreen();
    // Área segura (44) + bloco da saudação (12 + 48) + 12: não cobre o avatar nem o botão "+".
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 116 });
  });
});
