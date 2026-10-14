import { NavigationContainer } from '@react-navigation/native';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Screen } from '../components';
import { useAuth } from '../contexts';
import { colors } from '../theme';
import { AppRoutes } from './app.routes';
import { AuthRoutes } from './auth.routes';
import { webLinking } from './linking';
import { documentTitle, navigationTheme } from './options';

/**
 * Troca de pilha pela sessão: sem usuário, só as rotas públicas existem;
 * com usuário (Administrador ou Analista), só as do app. Não há como
 * "voltar" para o login com o gesto de voltar depois de entrar.
 * Na web, cada tela tem URL própria (histórico do navegador) e título de aba em português.
 */
export function Routes() {
  const { user, restoring } = useAuth();

  // Modo API: enquanto verifica se há sessão salva, não pisca o Login.
  if (restoring) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.text.secondary} />
        </View>
      </Screen>
    );
  }

  return (
    <NavigationContainer
      theme={navigationTheme}
      documentTitle={documentTitle}
      linking={Platform.OS === 'web' ? webLinking : undefined}
    >
      {user ? <AppRoutes /> : <AuthRoutes />}
    </NavigationContainer>
  );
}
