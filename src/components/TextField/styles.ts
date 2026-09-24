import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    height: layout.inputHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.page,
  },
  focused: {
    borderColor: colors.border.focus,
  },
  invalid: {
    borderColor: colors.severity.critical,
  },
  input: {
    ...typography.input,
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    color: colors.text.primary,
    // Web: o contorno de foco do navegador dá lugar à borda do próprio campo.
    outlineWidth: 0,
  },
});
