import { Platform, Pressable, Text, View } from 'react-native';
import { colors, iconStroke, templateIcons } from '../../theme';
import type { EmailTemplate } from '../../types';
import type { TemplateSelectMode } from '../TemplateSelect/selection';
import { styles } from './styles';

interface TemplateCardProps {
  template: EmailTemplate;
  mode: TemplateSelectMode;
  selected: boolean;
  invalid?: boolean;
  onPress: () => void;
}

/**
 * Estado do card para leitores de tela, em props ARIA (o RN converte no aparelho
 * e o react-native-web escreve no HTML):
 * - rádio (Nova campanha): `aria-checked`;
 * - filtro (Home): no aparelho, estado "selecionado"; no navegador, `aria-pressed`,
 *   que é o estado de botão de alternância (`aria-selected` não vale para role="button").
 */
function selectionState(isRadio: boolean, selected: boolean) {
  if (isRadio) return { 'aria-checked': selected };
  return Platform.OS === 'web' ? { 'aria-pressed': selected } : { 'aria-selected': selected };
}

/**
 * Card de modelo de e-mail. No modo `radio` os não selecionados ficam apagados
 * (#8E9DB5) e o selecionado ganha borda branca de 2 px, fundo #1F2738 e rádio cheio.
 */
export function TemplateCard({ template, mode, selected, invalid = false, onPress }: TemplateCardProps) {
  const Icon = templateIcons[template.id];
  const isRadio = mode === 'radio';
  const contentColor = isRadio && !selected ? colors.text.secondary : colors.text.primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={isRadio ? 'radio' : 'button'}
      {...selectionState(isRadio, selected)}
      accessibilityLabel={template.label}
      accessibilityHint={
        isRadio
          ? undefined
          : selected
            ? 'Toque de novo para mostrar todas as campanhas'
            : 'Filtra a lista de campanhas por este modelo'
      }
      testID={`template-card-${template.id}`}
      style={({ pressed }) => [
        styles.card,
        isRadio ? styles.cardRadio : styles.cardFilter,
        selected && styles.cardSelected,
        invalid && styles.cardInvalid,
        pressed && !selected && styles.cardPressed,
      ]}
    >
      {/* Destaque de 2 px desenhado por cima da borda: o card não muda de tamanho ao ser selecionado. */}
      {selected ? <View style={styles.selectionRing} /> : null}
      {isRadio ? (
        <View style={[styles.radio, selected && styles.radioChecked]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      ) : null}
      <Icon size={isRadio ? 24 : 32} color={contentColor} strokeWidth={iconStroke} />
      <Text style={[styles.label, { color: contentColor }]} numberOfLines={1}>
        {template.label}
      </Text>
    </Pressable>
  );
}
