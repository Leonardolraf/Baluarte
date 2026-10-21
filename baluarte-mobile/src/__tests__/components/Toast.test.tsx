import { render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useToast, useToastOffset } from '../../contexts';
import { ToastProvider } from '../../contexts/toast';
import { TEST_METRICS } from '../../test-utils';

/** Tela de mentira: informa (ou não) um deslocamento e mostra um aviso. */
function FakeScreen({ offset }: { offset: number | null }) {
  const { showToast } = useToast();
  useToastOffset(offset ?? 0, offset !== null);
  useEffect(() => showToast('Aviso de teste'), [showToast]);
  return null;
}

function ui(...offsets: (number | null)[]) {
  return (
    <SafeAreaProvider initialMetrics={TEST_METRICS}>
      <ToastProvider>
        {offsets.map((offset, index) => (
          <FakeScreen key={index} offset={offset} />
        ))}
      </ToastProvider>
    </SafeAreaProvider>
  );
}

describe('Toast — posição informada pela tela em foco', () => {
  it('sem tela informando: logo abaixo da área segura (44 + 12)', async () => {
    await render(ui(null));
    expect(screen.getByText('Aviso de teste')).toBeOnTheScreen();
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 56 });
  });

  it('com cabeçalho informado: abaixo dele (44 + 60 + 12) e volta quando a tela sai', async () => {
    const view = await render(ui(60));
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 116 });

    await view.rerender(ui(null));
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 56 });
  });

  it('na troca de telas, com duas registradas ao mesmo tempo, vale o maior deslocamento', async () => {
    const view = await render(ui(60, 20));
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 116 });

    await view.rerender(ui(null, 20));
    expect(screen.getByTestId('toast-anchor')).toHaveStyle({ top: 76 });
  });
});
