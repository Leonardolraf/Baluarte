import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CampaignDetailsScreen } from '../screens/CampaignDetails';
import { HomeScreen } from '../screens/Home';
import { NewCampaignScreen } from '../screens/NewCampaign';
import { TrainingScreen } from '../screens/Training';
import type { AppStackParamList } from '../types/navigation';
import { stackScreenOptions } from './options';

const Stack = createNativeStackNavigator<AppStackParamList>();

/**
 * Fluxo autenticado: Home → Nova campanha / Detalhes → Treinamento.
 * O `title` de cada tela vira o título da aba no navegador (o cabeçalho é o componente Header).
 */
export function AppRoutes() {
  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={stackScreenOptions}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Campanhas' }} />
      <Stack.Screen name="NewCampaign" component={NewCampaignScreen} options={{ title: 'Nova campanha' }} />
      <Stack.Screen
        name="CampaignDetails"
        component={CampaignDetailsScreen}
        options={{ title: 'Detalhes da campanha' }}
      />
      <Stack.Screen name="Training" component={TrainingScreen} options={{ title: 'Treinamento' }} />
    </Stack.Navigator>
  );
}
