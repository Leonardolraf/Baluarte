import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingTop: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxl,
  },
  mark: {
    marginTop: spacing.xxxl,
    alignSelf: 'flex-start',
  },
  title: {
    ...typography.heroTitle,
    marginTop: spacing.xl,
    color: colors.text.primary,
  },
  description: {
    ...typography.body,
    marginTop: spacing.md,
    color: colors.text.secondary,
  },
  field: {
    marginTop: spacing.xxxl,
  },
  submit: {
    marginTop: spacing.xxl,
  },
  link: {
    alignSelf: 'center',
    marginTop: spacing.xl,
  },
  linkPressed: {
    opacity: 0.6,
  },
  linkText: {
    ...typography.label,
    color: colors.text.primary,
  },
});
