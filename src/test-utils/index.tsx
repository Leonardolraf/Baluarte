import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders } from '../contexts';
import { buildInitialCampaigns } from '../data/campaigns';
import { DEMO_USERS } from '../data/users';
import { Routes } from '../routes';
import type { Campaign, User } from '../types';

/** Mesmas medidas das capturas de referência (375×812, iPhone com notch). */
export const TEST_METRICS = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
};

export const ADMIN: User = DEMO_USERS[0];
export const ANALYST: User = DEMO_USERS[1];

/** "Hoje" fixo dos testes: 23/09/2026 às 10:00 (as capturas usam essa data). */
export const TEST_NOW = new Date(2026, 8, 23, 10, 0, 0, 0);

export function testCampaigns(now: Date = TEST_NOW): Campaign[] {
  return buildInitialCampaigns(now);
}

/**
 * Congela só o relógio de `Date` em TEST_NOW (timers continuam reais), para
 * "hoje + 7 dias" e "data futura" darem sempre o mesmo resultado.
 * O `jest.setup.ts` volta ao relógio real depois de cada teste.
 */
export function freezeDate(now: Date = TEST_NOW) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

interface RenderAppOptions {
  user?: User | null;
  campaigns?: Campaign[];
}

/** Renderiza o app inteiro (providers + navegação), já logado ou não. */
export async function renderApp({ user = null, campaigns }: RenderAppOptions = {}) {
  return render(
    <SafeAreaProvider initialMetrics={TEST_METRICS}>
      <AppProviders initialUser={user} initialCampaigns={campaigns ?? testCampaigns()}>
        <Routes />
      </AppProviders>
    </SafeAreaProvider>,
  );
}
