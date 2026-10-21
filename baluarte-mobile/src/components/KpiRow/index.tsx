import { Text, View } from 'react-native';
import type { Kpi } from '../../lib/campaigns';
import { styles } from './styles';

interface KpiRowProps {
  items: readonly Kpi[];
}

/** Linha de indicadores: numeral em Archivo 800 + rótulo em caixa alta. */
export function KpiRow({ items }: KpiRowProps) {
  return (
    <View style={styles.container}>
      {items.map((item) => (
        <View
          key={item.label}
          style={styles.item}
          accessible
          accessibilityLabel={item.accessibilityLabel}
          testID={`kpi-${item.label}`}
        >
          <Text style={styles.value}>{item.value}</Text>
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
