import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  name: {
    ...typography.wordmark,
    color: colors.text.primary,
    textAlign: 'center',
  },
  tagline: {
    ...typography.tagline,
    marginTop: spacing.xs,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
