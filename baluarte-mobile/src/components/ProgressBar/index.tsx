import { View } from 'react-native';
import { colors } from '../../theme';
import { styles } from './styles';

interface ProgressBarProps {
  /** 0–100. */
  value: number;
  accessibilityLabel?: string;
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Barra de progresso de 8 px; verde quando chega a 100%. O valor vai em props ARIA:
 * o RN as converte no aparelho e o react-native-web as escreve no HTML.
 */
export function ProgressBar({ value, accessibilityLabel = 'Progresso do treinamento' }: ProgressBarProps) {
  const progress = clamp(value);
  const fillColor = progress >= 100 ? colors.success.solid : colors.action.primary;

  return (
    <View
      style={styles.track}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={`${progress}%`}
      testID="progress-bar"
    >
      <View style={[styles.fill, { width: `${progress}%`, backgroundColor: fillColor }]} />
    </View>
  );
}
