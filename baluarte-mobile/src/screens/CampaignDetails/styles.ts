import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.lg,
  },
  recipients: {
    paddingTop: spacing.xxl,
    paddingHorizontal: layout.screenPadding,
  },
  listHeader: {
    marginBottom: spacing.lg,
  },
  note: {
    marginTop: spacing.sm,
  },
  footer: {
    paddingTop: spacing.md,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: layout.screenPadding,
  },
  notFoundTitle: {
    ...typography.sectionTitle,
    color: colors.text.primary,
    textAlign: 'center',
  },
});
