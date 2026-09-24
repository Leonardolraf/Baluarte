import { StyleSheet } from 'react-native';
import { colors, layout, radius } from '../../theme';

export const styles = StyleSheet.create({
  button: {
    width: layout.buttonHeight,
    height: layout.buttonHeight,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.action.primary,
  },
  pressed: {
    backgroundColor: colors.action.primaryPressed,
  },
});
