import { Text, View } from 'react-native';
import { Button, Screen } from '../../components';
import { colors, iconStroke, icons } from '../../theme';
import type { AuthScreenProps } from '../../types/navigation';
import { styles } from './styles';

export function ResetSentScreen({ navigation }: AuthScreenProps<'ResetSent'>) {
  function backToLogin() {
    // Limpa a pilha: voltar daqui não retorna ao formulário de redefinição.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <icons.Mail size={24} color={colors.success.text} strokeWidth={iconStroke} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Solicitação enviada
        </Text>
        <Text style={styles.message}>
          Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.
        </Text>
        <Text style={styles.hint}>
          Não recebeu? Verifique a caixa de spam ou aguarde alguns minutos antes de tentar de novo.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button title="Voltar ao login" onPress={backToLogin} />
      </View>
    </Screen>
  );
}
