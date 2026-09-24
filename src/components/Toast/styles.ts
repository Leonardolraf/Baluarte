import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: layout.screenPadding,
    right: layout.screenPadding,
    zIndex: 10,
    // O aviso não tem ações: toques atravessam para a tela que está por baixo.
    pointerEvents: 'none',
  },
  toast: {
    minHeight: layout.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.success.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.surface,
    boxShadow: '0px 12px 24px rgba(0, 0, 0, 0.35)',
  },
  message: {
    ...typography.body,
    flex: 1,
    color: colors.text.primary,
  },
});
