import { StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

/** Borda que ocupa espaço: sempre 1 px, então o card não muda de tamanho ao ser selecionado. */
const BORDER = 1;
/** Destaque do selecionado (2 px), desenhado por cima da borda. */
const SELECTED_BORDER = 2;
const RADIO_SIZE = 14;
const RADIO_DOT = 6;
/** O rádio fica a 10 px da borda externa do card (captura 20); o posicionamento conta de dentro da borda. */
const RADIO_OFFSET = 10 - BORDER;

export const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER,
    borderColor: colors.border.default,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    paddingHorizontal: spacing.xs,
  },
  /** Home: 120 px, ícone 32. */
  cardFilter: {
    height: 120,
    gap: spacing.lg,
  },
  /** Nova campanha: 96 px, ícone 24 e rádio no canto. */
  cardRadio: {
    height: 96,
    gap: spacing.md,
  },
  cardSelected: {
    borderColor: colors.border.selected,
    backgroundColor: colors.bg.selected,
  },
  /**
   * Contorno do selecionado: cobre a borda de 1 px e avança 1 px para dentro,
   * com o mesmo contorno externo dos outros cards (como na captura 20).
   */
  selectionRing: {
    position: 'absolute',
    top: -BORDER,
    right: -BORDER,
    bottom: -BORDER,
    left: -BORDER,
    borderWidth: SELECTED_BORDER,
    borderColor: colors.border.selected,
    borderRadius: radius.md,
    pointerEvents: 'none',
  },
  cardInvalid: {
    borderColor: colors.severity.critical,
  },
  cardPressed: {
    backgroundColor: colors.bg.raised,
  },
  label: {
    ...typography.label,
    fontFamily: typography.strong.fontFamily,
  },
  radio: {
    position: 'absolute',
    top: RADIO_OFFSET,
    right: RADIO_OFFSET,
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: RADIO_SIZE / 2,
    borderWidth: 1.5,
    borderColor: colors.border.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioChecked: {
    borderWidth: 0,
    backgroundColor: colors.action.primary,
  },
  radioDot: {
    width: RADIO_DOT,
    height: RADIO_DOT,
    borderRadius: RADIO_DOT / 2,
    backgroundColor: colors.action.onPrimary,
  },
});
