import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    backgroundColor: colors.bg.overlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: layout.modalMaxWidth,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface,
    boxShadow: '0px 24px 48px rgba(0, 0, 0, 0.45)',
  },
  title: {
    ...typography.sectionTitle,
    color: colors.text.primary,
  },
  message: {
    ...typography.body,
    marginTop: spacing.sm,
    color: colors.text.secondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  action: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
});
