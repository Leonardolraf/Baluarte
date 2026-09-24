import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    height: layout.buttonLargeHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.sm,
    backgroundColor: colors.action.primary,
    overflow: 'hidden',
  },
  pressed: {
    backgroundColor: colors.action.primaryPressed,
  },
  iconBlock: {
    width: layout.buttonLargeHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.border.onPrimary,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.button,
    color: colors.action.onPrimary,
  },
});
