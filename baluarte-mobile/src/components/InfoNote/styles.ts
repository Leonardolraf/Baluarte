import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  icon: {
    marginTop: 2,
  },
  text: {
    ...typography.caption,
    flex: 1,
    lineHeight: 19,
    color: colors.text.secondary,
  },
});
