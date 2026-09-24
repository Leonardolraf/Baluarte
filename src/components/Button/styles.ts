import { StyleSheet, type ViewStyle } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export type ButtonVariant = 'primary' | 'outline' | 'success';

export const styles = StyleSheet.create({
  base: {
    height: layout.buttonHeight,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.button,
  },
  disabled: {
    opacity: 0.5,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.action.primary,
  },
  primaryPressed: {
    backgroundColor: colors.action.primaryPressed,
  },
  outline: {
    borderWidth: 1,
    borderColor: colors.border.input,
    backgroundColor: 'transparent',
  },
  outlinePressed: {
    backgroundColor: colors.bg.surface,
  },
  success: {
    borderWidth: 1,
    borderColor: colors.success.solid,
    backgroundColor: colors.bg.surface,
  },
  successPressed: {
    backgroundColor: colors.bg.raised,
  },
});

/** Fundo, estado pressionado e cor do conteúdo (texto + ícone) de cada variante. */
export const variants: Record<
  ButtonVariant,
  { container: ViewStyle; pressed: ViewStyle; content: string }
> = {
  primary: {
    container: variantStyles.primary,
    pressed: variantStyles.primaryPressed,
    content: colors.action.onPrimary,
  },
  outline: {
    container: variantStyles.outline,
    pressed: variantStyles.outlinePressed,
    content: colors.text.primary,
  },
  success: {
    container: variantStyles.success,
    pressed: variantStyles.successPressed,
    content: colors.success.text,
  },
};
