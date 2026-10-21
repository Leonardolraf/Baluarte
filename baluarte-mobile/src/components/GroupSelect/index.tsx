import { Pressable, Text, View } from 'react-native';
import { colors, iconStroke, icons } from '../../theme';
import { styles } from './styles';

interface GroupSelectProps {
  value: string;
  onPress: () => void;
  invalid?: boolean;
}

/** Linha do grupo-alvo: bloco com ícone, nome do grupo, legenda e chevron. Abre o GroupPickerModal. */
export function GroupSelect({ value, onPress, invalid = false }: GroupSelectProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Grupo-alvo: ${value}`}
      accessibilityHint="Abre a lista de grupos-alvo"
      testID="group-select"
      style={({ pressed }) => [styles.container, invalid && styles.invalid, pressed && styles.pressed]}
    >
      <View style={styles.iconBlock}>
        <icons.Users size={24} color={colors.text.primary} strokeWidth={iconStroke} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          Toque para trocar o grupo-alvo
        </Text>
      </View>
      <icons.ChevronRight
        size={20}
        color={colors.text.secondary}
        strokeWidth={iconStroke}
        style={styles.chevron}
      />
    </Pressable>
  );
}
