import type { TextStyle } from 'react-native';

/**
 * Famílias carregadas em App.tsx (ver `fonts.ts`).
 * display = Archivo (títulos, numerais, wordmark) · corpo = IBM Plex Sans · dados = IBM Plex Mono.
 * Com fonte customizada não se usa `fontWeight`: cada peso é uma família.
 */
export const fonts = {
  displayMedium: 'Archivo_500Medium',
  displayBold: 'Archivo_700Bold',
  displayExtraBold: 'Archivo_800ExtraBold',
  bodyRegular: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemiBold: 'IBMPlexSans_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
} as const;

/** Estilos de texto nomeados pelo papel (não pelo tamanho). */
export const typography = {
  wordmark: { fontFamily: fonts.displayExtraBold, fontSize: 26, lineHeight: 32 },
  heroTitle: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 34 },
  pageTitle: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 30 },
  greeting: { fontFamily: fonts.displayMedium, fontSize: 22, lineHeight: 28 },
  greetingStrong: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28 },
  campaignName: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28 },
  numeral: { fontFamily: fonts.displayExtraBold, fontSize: 22, lineHeight: 28 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 22 },
  initials: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: 20 },
  bodyLarge: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22 },
  body: { fontFamily: fonts.bodyRegular, fontSize: 14, lineHeight: 20 },
  /** Parágrafo de abertura (resumo do treinamento): 14 px com entrelinha de leitura. */
  lead: { fontFamily: fonts.bodyRegular, fontSize: 14, lineHeight: 21 },
  bodySmall: { fontFamily: fonts.bodyRegular, fontSize: 13, lineHeight: 18 },
  /** Texto corrido dentro de cartões (seções e listas do treinamento). */
  paragraph: { fontFamily: fonts.bodyRegular, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: fonts.bodyRegular, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20 },
  labelSmall: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  /** Texto de pílula (status da campanha nos Detalhes). */
  badge: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16 },
  strong: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20 },
  button: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20 },
  input: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 20 },
  /** Rótulos em caixa alta (textos já escritos em maiúsculas). */
  caps: { fontFamily: fonts.bodySemiBold, fontSize: 11, lineHeight: 16, letterSpacing: 0.8 },
  capsSmall: { fontFamily: fonts.bodySemiBold, fontSize: 10, lineHeight: 14, letterSpacing: 1 },
  tagline: { fontFamily: fonts.bodySemiBold, fontSize: 10, lineHeight: 14, letterSpacing: 1.4 },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20 },
} satisfies Record<string, TextStyle>;
