import { getPathFromState, getStateFromPath, type LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';

type RootScreen = keyof RootStackParamList;

/**
 * Tela que fica embaixo quando uma tela é aberta direto pela URL (link colado ou
 * página recarregada): assim o "voltar" sempre tem para onde ir.
 */
const BASE_SCREEN: Record<RootScreen, RootScreen | null> = {
  Login: null,
  ResetPassword: 'Login',
  ResetSent: 'Login',
  Home: null,
  NewCampaign: 'Home',
  CampaignDetails: 'Home',
  Training: 'Home',
};

function isRootScreen(name: string): name is RootScreen {
  return Object.prototype.hasOwnProperty.call(BASE_SCREEN, name);
}

/**
 * URLs do app no navegador (só na web, ver `routes/index.tsx`): cada tela ganha um
 * caminho e uma entrada no histórico, então o botão Voltar do navegador volta dentro
 * do app em vez de sair dele. No aparelho (Expo Go, sem esquema próprio) não há deep link.
 *
 * A sessão fica só em memória: recarregar a página mostra o Login e, depois de entrar,
 * o app abre a tela da URL (com a Home embaixo).
 */
export const webLinking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      Login: '',
      ResetPassword: 'redefinir-senha',
      ResetSent: 'redefinir-senha/enviada',
      Home: 'campanhas',
      NewCampaign: 'campanhas/nova',
      CampaignDetails: 'campanhas/:campaignId',
      Training: 'treinamentos/:trainingId',
    },
  },
  getStateFromPath: (path, options) => {
    const state = getStateFromPath(path, options);
    const route = state?.routes.length === 1 ? state.routes[0] : undefined;
    const base = route && isRootScreen(route.name) ? BASE_SCREEN[route.name] : null;
    if (!state || !route || !base) return state;
    return { ...state, index: 1, routes: [{ name: base }, route] };
  },
  // Parâmetros fora do caminho não viram query string: o e-mail que o Login passa
  // para a redefinição de senha não aparece na barra de endereço nem no histórico.
  getPathFromState: (state, options) => getPathFromState(state, options).split('?')[0],
};
