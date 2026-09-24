import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/Login';
import { ResetPasswordScreen } from '../screens/ResetPassword';
import { ResetSentScreen } from '../screens/ResetSent';
import type { AuthStackParamList } from '../types/navigation';
import { stackScreenOptions } from './options';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * Fluxo público: Login → Redefinir senha → Solicitação enviada.
 * A confirmação substitui o formulário na pilha, então voltar dela (gesto, botão
 * do Android ou do navegador) leva ao Login, como o botão "Voltar ao login".
 */
export function AuthRoutes() {
  return (
    <Stack.Navigator initialRouteName="Login" screenOptions={stackScreenOptions}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Entrar' }} />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: 'Redefinir senha' }}
      />
      <Stack.Screen name="ResetSent" component={ResetSentScreen} options={{ title: 'Solicitação enviada' }} />
    </Stack.Navigator>
  );
}
