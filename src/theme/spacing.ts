/** Escala de espaçamento com base 4 (DESIGN.md). */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Raios: 8 em inputs/botões, 12 em cartões, 16 em modais. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Medidas fixas de componentes (vêm do protótipo, 375×812). */
export const layout = {
  /** Inset horizontal de todas as telas. */
  screenPadding: 24,
  /** Altura do cabeçalho abaixo da área segura (inclui a borda inferior). */
  headerHeight: 60,
  buttonHeight: 48,
  buttonLargeHeight: 56,
  inputHeight: 44,
  iconBlock: 64,
  avatar: 48,
  smallInputWidth: 48,
  groupRowHeight: 56,
  textAreaMinHeight: 80,
  /** Altura mínima do banner dos Detalhes. */
  bannerMinHeight: 233,
  modalMaxWidth: 327,
} as const;
