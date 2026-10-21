import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders } from '../../contexts';
import { findTraining, TRAININGS } from '../../data/trainings';
import { AppRoutes } from '../../routes/app.routes';
import { ADMIN, renderApp, TEST_METRICS, testCampaigns } from '../../test-utils';
import type { TrainingId } from '../../types';

/** Da Home: abre a campanha Simulação Q3 (modelo Urgência) e o treinamento dela. */
async function openUrgencyTrainingFromHome() {
  await fireEvent.press(await screen.findByTestId('campaign-item-camp-001'));
  await fireEvent.press(screen.getByRole('button', { name: 'Ver material de treinamento' }));
}

async function openUrgencyTraining() {
  await renderApp({ user: ADMIN });
  await openUrgencyTrainingFromHome();
}

/** Do Treinamento: volta à Home e sai da conta. */
async function signOutFromTraining() {
  await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
  await fireEvent.press(screen.getByRole('button', { name: /Sair da conta/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Sim, sair' }));
}

async function signIn(email: string) {
  await fireEvent.changeText(await screen.findByLabelText('E-mail'), email);
  await fireEvent.changeText(screen.getByLabelText('Senha'), 'qualquer-senha');
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

describe('Treinamento', () => {
  it('mostra o conteúdo completo do módulo de urgência', async () => {
    await openUrgencyTraining();
    const training = TRAININGS['trn-urgency'];

    expect(screen.getByText('Phishing por urgência')).toBeOnTheScreen();
    expect(screen.getByText('US-005')).toBeOnTheScreen();
    expect(screen.getByText(training.title)).toBeOnTheScreen();
    expect(screen.getByText(training.summary)).toBeOnTheScreen();
    expect(screen.getByText('PROGRESSO')).toBeOnTheScreen();
    for (const section of training.sections) {
      expect(screen.getByText(section.heading)).toBeOnTheScreen();
      expect(screen.getByText(section.body)).toBeOnTheScreen();
    }
    expect(screen.getByText('Sinais de alerta')).toBeOnTheScreen();
    expect(screen.getByText('O que denuncia uma mensagem maliciosa')).toBeOnTheScreen();
    expect(screen.getByText('Boas práticas')).toBeOnTheScreen();
    expect(screen.getByText('Como reagir com segurança')).toBeOnTheScreen();
    for (const item of [...training.warningSigns, ...training.bestPractices]) {
      expect(screen.getByText(item)).toBeOnTheScreen();
    }
  });

  it('o botão alterna "Marcar como concluído" ↔ "Concluído" e a barra vai a 100%', async () => {
    await openUrgencyTraining();
    const progress = screen.getByRole('progressbar');

    expect(progress).toHaveAccessibilityValue({ min: 0, max: 100, now: 0 });

    await fireEvent.press(screen.getByRole('button', { name: 'Marcar como concluído' }));

    expect(screen.getByRole('button', { name: 'Concluído' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Marcar como concluído' })).not.toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 100 });
    expect(screen.getByText('Treinamento concluído!')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Concluído' }));

    expect(screen.getByRole('button', { name: 'Marcar como concluído' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 0 });
  });

  it('a conclusão fica guardada por módulo ao sair e voltar', async () => {
    await openUrgencyTraining();

    await fireEvent.press(screen.getByRole('button', { name: 'Marcar como concluído' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ver material de treinamento' }));

    expect(await screen.findByRole('button', { name: 'Concluído' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 100 });
  });

  it('a conclusão é de cada pessoa: outra conta não herda, e a mesma conta reencontra', async () => {
    await openUrgencyTraining();
    await fireEvent.press(screen.getByRole('button', { name: 'Marcar como concluído' }));
    await signOutFromTraining();

    // O analista abre o mesmo módulo: ainda não concluído para ele.
    await signIn('analista@empresa.com');
    await openUrgencyTrainingFromHome();
    expect(screen.getByRole('button', { name: 'Marcar como concluído' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 0 });
    await signOutFromTraining();

    // O administrador volta e encontra a própria conclusão.
    await signIn('admin@empresa.com');
    await openUrgencyTrainingFromHome();
    expect(screen.getByRole('button', { name: 'Concluído' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 100 });
  });

  it('findTraining só aceita os três módulos (nem chaves do protótipo do objeto)', () => {
    expect(findTraining('trn-authority')?.moduleCode).toBe('US-006');
    expect(findTraining('trn-inexistente')).toBeUndefined();
    expect(findTraining('constructor')).toBeUndefined();
    expect(findTraining('__proto__')).toBeUndefined();
  });

  it('id desconhecido (URL digitada na web): avisa e volta para a lista', async () => {
    await render(
      <SafeAreaProvider initialMetrics={TEST_METRICS}>
        <AppProviders initialUser={ADMIN} initialCampaigns={testCampaigns()}>
          <NavigationContainer
            initialState={{
              index: 1,
              routes: [
                { name: 'Home' },
                { name: 'Training', params: { trainingId: 'constructor' as TrainingId } },
              ],
            }}
          >
            <AppRoutes />
          </NavigationContainer>
        </AppProviders>
      </SafeAreaProvider>,
    );

    expect(screen.getByText('Treinamento não encontrado')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Voltar para campanhas' }));

    expect(await screen.findByText('Olá, Leonardo')).toBeOnTheScreen();
  });
});
