import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    height: layout.groupRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.surface,
    overflow: 'hidden',
  },
  invalid: {
    borderColor: colors.severity.critical,
  },
  pressed: {
    backgroundColor: colors.bg.raised,
  },
  iconBlock: {
    width: layout.groupRowHeight - 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.strong,
    color: colors.text.primary,
  },
  caption: {
    ...typography.caption,
    marginTop: spacing.xxs,
    color: colors.text.secondary,
  },
  chevron: {
    marginRight: spacing.lg,
  },
});
