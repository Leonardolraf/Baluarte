import type { CampaignStatus, RecipientStage } from '../types';

/**
 * Tokens de cor do Baluarte — tema escuro do produto (DESIGN.md).
 * Regra da marca: a única cor cromática da interface é o RISCO (severidade,
 * status de campanha e etapa do destinatário). Todo o resto é neutro.
 */
const palette = {
  ink: '#0B1220',
  slate900: '#131C2E',
  inkSoft: '#1B2A44',
  selected: '#1F2738',
  slate800: '#26324A',
  slate700: '#3C4B63',
  slate500: '#647590',
  slate400: '#8E9DB5',
  slate300: '#C3CEDC',
  slate200: '#DCE3EC',
  slate100: '#EEF2F7',
  white: '#FFFFFF',
} as const;

export const colors = {
  bg: {
    /** Fundo das telas (slate-950 / ink). */
    page: palette.ink,
    /** Cabeçalho, cartões e cards de modelo (slate-900). */
    surface: palette.slate900,
    /** Avatares e blocos de ícone (ink-soft). */
    raised: palette.inkSoft,
    /** Card de modelo selecionado no modo rádio. */
    selected: palette.selected,
    /** Véu atrás dos modais. */
    overlay: 'rgba(5, 8, 15, 0.72)',
  },
  border: {
    default: palette.slate800,
    input: palette.slate700,
    focus: palette.slate400,
    selected: palette.white,
    /** Divisória interna do botão branco. */
    onPrimary: palette.slate200,
  },
  text: {
    primary: palette.slate100,
    secondary: palette.slate400,
    muted: palette.slate500,
    error: '#FCA5A5',
  },
  action: {
    primary: palette.white,
    onPrimary: palette.ink,
    primaryPressed: palette.slate200,
  },
  severity: {
    critical: '#DC2626',
    high: '#EA580C',
    medium: '#CA8A04',
    low: '#16A34A',
    info: '#2563EB',
  },
  /** Feedback positivo: o mesmo verde de "Ativa" e "Reportou". */
  success: {
    background: 'rgba(5, 46, 22, 0.6)',
    border: 'rgba(34, 197, 94, 0.3)',
    borderStrong: 'rgba(34, 197, 94, 0.4)',
    text: '#86EFAC',
    solid: '#16A34A',
  },
  /** Erro de formulário: tom crítico. */
  danger: {
    background: 'rgba(69, 10, 10, 0.6)',
    border: 'rgba(239, 68, 68, 0.3)',
    text: '#FCA5A5',
  },
} as const;

/** Pílula de status: fundo, borda, ponto e texto. */
export interface StatusTone {
  background: string;
  border: string;
  dot: string;
  text: string;
}

export const campaignStatusTone: Record<CampaignStatus, StatusTone> = {
  active: {
    background: 'rgba(5, 46, 22, 0.6)',
    border: 'rgba(34, 197, 94, 0.3)',
    dot: '#22C55E',
    text: '#86EFAC',
  },
  scheduled: {
    background: 'rgba(8, 47, 73, 0.6)',
    border: 'rgba(14, 165, 233, 0.3)',
    dot: '#0EA5E9',
    text: '#7DD3FC',
  },
  completed: {
    background: palette.slate800,
    border: 'rgba(100, 117, 144, 0.3)',
    dot: palette.slate500,
    text: palette.slate300,
  },
};

/** Etapa do destinatário: ponto e texto. */
export interface StageTone {
  dot: string;
  text: string;
}

export const recipientStageTone: Record<RecipientStage, StageTone> = {
  received: { dot: palette.slate500, text: palette.slate200 },
  opened: { dot: '#0EA5E9', text: '#7DD3FC' },
  clicked: { dot: '#EA580C', text: '#FDBA74' },
  submitted: { dot: '#DC2626', text: '#FCA5A5' },
  reported: { dot: '#16A34A', text: '#86EFAC' },
  notReceived: { dot: palette.slate500, text: palette.slate400 },
};
