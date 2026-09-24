import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  input: {
    ...typography.mono,
    minHeight: layout.textAreaMinHeight,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.page,
    color: colors.text.primary,
    outlineWidth: 0,
  },
  focused: {
    borderColor: colors.border.focus,
  },
  invalid: {
    borderColor: colors.severity.critical,
  },
});
