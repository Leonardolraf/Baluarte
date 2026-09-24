import { Pressable, type PressableProps } from 'react-native';
import { colors, type LucideIcon } from '../../theme';
import { styles } from './styles';

interface SquareButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: LucideIcon;
  /** Obrigatório: o botão só tem ícone. */
  accessibilityLabel: string;
}

/** Botão quadrado 48×48 branco com ícone ink (o "+" da Home). */
export function SquareButton({ icon: Icon, ...rest }: SquareButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      {...rest}
    >
      <Icon size={24} color={colors.action.onPrimary} strokeWidth={2} />
    </Pressable>
  );
}
