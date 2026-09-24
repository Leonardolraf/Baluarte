import { StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  title: {
    ...typography.cardTitle,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xxs,
    color: colors.text.secondary,
  },
  body: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
});
