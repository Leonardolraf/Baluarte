import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

const HEIGHT = 8;

export const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.border.default,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: HEIGHT / 2,
  },
});
