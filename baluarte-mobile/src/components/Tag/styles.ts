import { StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    height: 26,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
  },
  label: {
    ...typography.labelSmall,
    fontFamily: typography.strong.fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text.primary,
  },
});
