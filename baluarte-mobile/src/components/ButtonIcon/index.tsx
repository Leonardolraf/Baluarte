import { Pressable, Text, View, type PressableProps } from 'react-native';
import { colors, iconStroke, type LucideIcon } from '../../theme';
import { styles } from './styles';

interface ButtonIconProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  icon: LucideIcon;
}

/** Botão branco de 56 px com bloco de ícone e divisória à esquerda ("Ver material de treinamento"). */
export function ButtonIcon({ title, icon: Icon, ...rest }: ButtonIconProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      {...rest}
    >
      <View style={styles.iconBlock}>
        <Icon size={22} color={colors.action.onPrimary} strokeWidth={iconStroke} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}
