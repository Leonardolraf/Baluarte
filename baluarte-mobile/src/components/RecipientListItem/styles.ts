import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    marginLeft: spacing.lg,
    gap: spacing.xs,
  },
  name: {
    ...typography.strong,
    color: colors.text.primary,
  },
});
