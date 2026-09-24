import { StyleSheet } from 'react-native';
import { radius } from '../../theme';

export const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    // Recua 8 px para o ícone (24) ficar exatamente no inset da tela.
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});
