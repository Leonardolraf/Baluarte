import { Pressable } from 'react-native';
import { colors, iconStroke, icons } from '../../theme';
import { styles } from './styles';

interface BackButtonProps {
  onPress: () => void;
  accessibilityLabel?: string;
}

/** Seta de voltar (alvo de toque 40×40, ícone alinhado ao inset de 24). */
export function BackButton({ onPress, accessibilityLabel = 'Voltar' }: BackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <icons.ArrowLeft size={24} color={colors.text.primary} strokeWidth={iconStroke} />
    </Pressable>
  );
}
