import { View } from 'react-native';
import { layout } from '../../theme';
import { styles } from './styles';

interface ListDividerProps {
  /** Recuo à esquerda: a linha começa na coluna do texto (depois do ícone/avatar). */
  inset?: number;
  /** Espaço acima e abaixo da linha. */
  spacingTop?: number;
  spacingBottom?: number;
}

/** Divisória de 1 px que começa no texto e vai até a borda direita da tela. */
export function ListDivider({ inset = 0, spacingTop = 12, spacingBottom = 12 }: ListDividerProps) {
  return (
    <View
      style={[
        styles.divider,
        {
          marginLeft: inset,
          // Sangra até a borda: compensa o inset horizontal da tela.
          marginRight: -layout.screenPadding,
          marginTop: spacingTop,
          marginBottom: spacingBottom,
        },
      ]}
    />
  );
}
