import { StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.danger.border,
    borderRadius: radius.sm,
    backgroundColor: colors.danger.background,
  },
  icon: {
    marginTop: 2,
  },
  message: {
    ...typography.body,
    flex: 1,
    color: colors.danger.text,
  },
});
