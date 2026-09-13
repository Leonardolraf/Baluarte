/** @type {import('tailwindcss').Config} */
// Tokens do sistema visual (ver DESIGN.md).
// Regra central: a única cor cromática da interface é a de RISCO (severidade/status);
// tudo que é interativo é monocromático (`ink`). A escala `slate` é sobrescrita por
// neutros com tinta de aço-azulado para o app inteiro mudar de temperatura sem
// tocar classe por classe em cada tela.
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#F7F9FC',
          100: '#EEF2F7',
          200: '#DCE3EC',
          300: '#C3CEDC',
          400: '#8E9DB5',
          500: '#647590', // 4,7:1 sobre branco
          600: '#5B6B85', // 5,4:1 sobre branco — rótulos em caixa alta
          700: '#3C4B63',
          800: '#26324A',
          900: '#131C2E',
          950: '#0B1220',
        },
        ink: {
          DEFAULT: '#0B1220',
          soft: '#1B2A44',
          muted: '#2A3A58',
        },
        // Alias monocromático mantido por compatibilidade: "brand" = ink.
        brand: {
          DEFAULT: '#0B1220',
          hover: '#1B2A44',
          soft: '#E4EAF2',
        },
        // Cores de severidade — usadas SOMENTE em indicadores de risco
        severity: {
          critical: '#dc2626',
          high: '#ea580c',
          medium: '#ca8a04',
          low: '#16a34a',
          info: '#2563eb',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Variable"', '"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Archivo Variable"', 'Archivo', '"IBM Plex Sans Variable"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Rótulos em caixa alta: 11 px com espaçamento largo.
        '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.08em' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(11 18 32 / 0.04), 0 1px 3px 0 rgb(11 18 32 / 0.06)',
        plate: '0 24px 48px -28px rgb(11 18 32 / 0.55), inset 0 1px 0 0 rgb(255 255 255 / 0.06)',
      },
      borderRadius: {
        plate: '16px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
      },
    },
  },
  plugins: [],
};
