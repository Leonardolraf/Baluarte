import { DarkTheme, type DocumentTitleOptions, type Theme } from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { colors } from '../theme';

const APP_NAME = 'Baluarte';

/** Tema da navegação alinhado aos tokens (sem flash branco entre as telas). */
export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.action.primary,
    background: colors.bg.page,
    card: colors.bg.surface,
    text: colors.text.primary,
    border: colors.border.default,
  },
};

/** As telas desenham o próprio cabeçalho (componente Header). */
export const stackScreenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  animation: 'slide_from_right',
  contentStyle: { backgroundColor: colors.bg.page },
};

/**
 * Título da aba do navegador (web): "Nova campanha · Baluarte", a partir do `title`
 * de cada tela, em vez do nome interno da rota em inglês.
 */
export const documentTitle: DocumentTitleOptions = {
  formatter: (options) => (options?.title ? `${options.title} · ${APP_NAME}` : APP_NAME),
};
