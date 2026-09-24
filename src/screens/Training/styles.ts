import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xl,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxl,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  code: {
    ...typography.caps,
    color: colors.text.secondary,
  },
  title: {
    ...typography.pageTitle,
    marginTop: spacing.lg,
    color: colors.text.primary,
  },
  /** 14/21, como na captura 11. */
  summary: {
    ...typography.lead,
    marginTop: spacing.lg,
    color: colors.text.secondary,
  },
  progressLabel: {
    ...typography.caps,
    marginTop: spacing.xl,
    color: colors.text.secondary,
  },
  progressBar: {
    marginTop: spacing.sm,
  },
  cards: {
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  /** Corpo dos cartões: 13/20, como na captura 11. */
  body: {
    ...typography.paragraph,
    color: colors.text.primary,
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
