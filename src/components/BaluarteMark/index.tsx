import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../../theme';
import { styles } from './styles';

/** Planta pentagonal do bastião no espaço de 32×32 (mesmo desenho do produto web). */
export const BASTION_PATH = 'M16 5.5 26.5 12.6 22.6 25.5H9.4L5.5 12.6Z';
const CHECK_PATH = 'M12.2 17.2 15 20l4.9-5.2';

interface BaluarteMarkProps {
  /** Lado do quadrado, em dp. */
  size?: number;
}

/** Marca do Baluarte: quadrado branco com o bastião e o check em tinta. Decorativa. */
export function BaluarteMark({ size = 32 }: BaluarteMarkProps) {
  return (
    <View aria-hidden style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 32 32">
        <Rect width={32} height={32} rx={8} fill={colors.action.primary} />
        <Path
          d={BASTION_PATH}
          fill="none"
          stroke={colors.action.onPrimary}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        <Path
          d={CHECK_PATH}
          fill="none"
          stroke={colors.action.onPrimary}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
