import { Pressable, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { iconStroke, type LucideIcon } from '../../theme';
import { styles, variants, type ButtonVariant } from './styles';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  /** primary = branco com texto ink · outline = contorno · success = "Concluído" (verde). */
  variant?: ButtonVariant;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}

/** Botão de 48 px. Monocromático (DESIGN.md): o verde só aparece no estado "Concluído". */
export function Button({ title, variant = 'primary', icon: Icon, disabled, style, ...rest }: ButtonProps) {
  const tone = variants[variant];

  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={Boolean(disabled)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        tone.container,
        pressed && tone.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {Icon ? <Icon size={20} color={tone.content} strokeWidth={iconStroke} /> : null}
      <Text style={[styles.title, { color: tone.content }]}>{title}</Text>
    </Pressable>
  );
}
