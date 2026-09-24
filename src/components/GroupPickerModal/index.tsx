import { Modal, Pressable, Text, View } from 'react-native';
import { TARGET_GROUPS } from '../../data/groups';
import { colors, iconStroke, icons } from '../../theme';
import { styles } from './styles';

interface GroupPickerModalProps {
  visible: boolean;
  selected: string;
  groups?: readonly string[];
  onSelect: (group: string) => void;
  onClose: () => void;
}

/** Modal de escolha do grupo-alvo: tocar num grupo escolhe e fecha; o selecionado tem check. */
export function GroupPickerModal({
  visible,
  selected,
  groups = TARGET_GROUPS,
  onSelect,
  onClose,
}: GroupPickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Toque fora do cartão fecha o modal. */}
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Grupo-alvo
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fechar seleção de grupo-alvo"
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressedIcon}
            >
              <icons.X size={20} color={colors.text.secondary} strokeWidth={iconStroke} />
            </Pressable>
          </View>

          <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Grupos-alvo">
            {groups.map((group) => {
              const isSelected = group === selected;
              return (
                <Pressable
                  key={group}
                  onPress={() => onSelect(group)}
                  accessibilityRole="radio"
                  aria-checked={isSelected}
                  accessibilityLabel={group}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>{group}</Text>
                  {isSelected ? (
                    <icons.Check size={18} color={colors.text.primary} strokeWidth={2} />
                  ) : (
                    <icons.ChevronRight size={16} color={colors.text.muted} strokeWidth={iconStroke} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
