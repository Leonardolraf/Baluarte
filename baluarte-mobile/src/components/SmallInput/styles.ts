import { StyleSheet } from 'react-native';
import { colors, layout, radius, typography } from '../../theme';

export const styles = StyleSheet.create({
  input: {
    ...typography.strong,
    width: layout.smallInputWidth,
    height: layout.inputHeight,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.page,
    color: colors.text.primary,
    textAlign: 'center',
    outlineWidth: 0,
  },
  focused: {
    borderColor: colors.border.focus,
  },
  invalid: {
    borderColor: colors.severity.critical,
  },
});
