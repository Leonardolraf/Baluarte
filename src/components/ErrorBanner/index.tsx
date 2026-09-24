import { Text, View } from 'react-native';
import { colors, iconStroke, icons } from '../../theme';
import { styles } from './styles';

interface ErrorBannerProps {
  message: string;
}

/** Erro do formulário inteiro (credenciais inválidas, perfil sem acesso). */
export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <View style={styles.container} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <icons.Info size={16} color={colors.danger.text} strokeWidth={iconStroke} style={styles.icon} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}
