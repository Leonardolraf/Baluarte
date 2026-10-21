import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { colors } from '../../theme';
import { styles } from './styles';

/** Vértices do bastião no espaço 32×32 (o mesmo pentágono da marca). */
const BASTION_POINTS: ReadonlyArray<readonly [number, number]> = [
  [16, 5.5],
  [26.5, 12.6],
  [22.6, 25.5],
  [9.4, 25.5],
  [5.5, 12.6],
];
/** O pentágono ocupa x 5,5–26,5 (21) e y 5,5–25,5 (20) ao redor do centro (16, 16). */
const HALF_WIDTH = 10.5;
const TOP_EXTENT = 10.5;
const HEIGHT = 20;
const PADDING = 1;

interface BastionRingsProps {
  /** Escala de cada anel em relação ao desenho de 32 (maior primeiro). */
  scales?: readonly number[];
  /** Opacidade de cada anel, na mesma ordem. */
  opacities?: readonly number[];
  color?: string;
  strokeWidth?: number;
  /** Conteúdo centralizado no centro dos anéis (ex.: a marca). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

function ringPoints(scale: number, centerX: number, centerY: number): string {
  return BASTION_POINTS.map(([x, y]) => `${centerX + (x - 16) * scale},${centerY + (y - 16) * scale}`).join(
    ' ',
  );
}

/** Ilustração de pentágonos concêntricos (Login e banner dos Detalhes). Decorativa. */
export function BastionRings({
  scales = [10.5, 8, 5.6],
  opacities = [0.9, 0.7, 0.5],
  color = colors.border.default,
  strokeWidth = 1,
  children,
  style,
}: BastionRingsProps) {
  const outer = Math.max(...scales);
  const width = HALF_WIDTH * 2 * outer + PADDING * 2;
  const height = HEIGHT * outer + PADDING * 2;
  const centerX = width / 2;
  const centerY = TOP_EXTENT * outer + PADDING;

  return (
    <View style={[{ width, height }, style]} aria-hidden>
      <Svg width={width} height={height}>
        {scales.map((scale, index) => (
          <Polygon
            key={scale}
            points={ringPoints(scale, centerX, centerY)}
            fill="none"
            stroke={color}
            strokeOpacity={opacities[index] ?? 1}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        ))}
      </Svg>
      {children ? (
        // Caixa de centralização com altura 2 × centerY: o filho fica no centro dos anéis.
        <View style={[styles.center, { height: centerY * 2 }]}>{children}</View>
      ) : null}
    </View>
  );
}
