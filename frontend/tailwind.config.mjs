/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md}'],
  theme: {
    extend: {
      colors: {
        // Cool, near-black architecture. No neon.
        ink: {
          950: '#08090C',
          900: '#0C0E12',
          850: '#111419',
          800: '#171B22',
          750: '#1E232C',
          700: '#262C37',
        },
        // Frosted white → cool gray text ramp
        mist: {
          50: '#F5F7FA',
          100: '#E8EBF0',
          200: '#D2D7DF',
          300: '#AEB5C1',
          400: '#8A93A1',
          500: '#6E7683',
          600: '#565D68',
          700: '#3E444E',
        },
        // A restrained aurora — desaturated, editorial, never neon. Each accent
        // themes one part of the story; used on eyebrows, edges and glows.
        teal: { DEFAULT: '#63B7AD', soft: '#478079', deep: '#274B47' },
        iris: { DEFAULT: '#8E8AD6', soft: '#615FA0', deep: '#332F63' }, // periwinkle-violet
        amber: { DEFAULT: '#D6A45C', soft: '#9C7840', deep: '#4E3A1F' }, // warm gold
        coral: { DEFAULT: '#DC8279', soft: '#A45C55', deep: '#4E2A27' }, // soft rose
        sky: { DEFAULT: '#6E9BD1', soft: '#4E6E97', deep: '#2A3D57' }, // cool blue
        steel: { DEFAULT: '#8497AE', soft: '#5E6E84' },
        haze: { DEFAULT: '#8E8AD6', soft: '#615FA0' }, // alias -> iris
        // App signal colors (muted)
        signal: { ok: '#63B79C', warn: '#D6A45C', alert: '#DC8279' },
        // Legacy aliases so pre-redesign app components keep compiling
        cyan: '#63B7AD',
        mint: '#63B79C',
        rose: '#DC8279',
        stroke: 'rgba(255,255,255,0.10)',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        heading: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.045em',
        editorial: '-0.02em',
      },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.09) inset, 0 24px 60px -28px rgba(0,0,0,0.75), 0 6px 18px -10px rgba(0,0,0,0.55)',
        'glass-lg': '0 1px 0 0 rgba(255,255,255,0.12) inset, 0 40px 100px -30px rgba(0,0,0,0.85), 0 12px 28px -14px rgba(0,0,0,0.6)',
        edge: '0 0 0 1px rgba(255,255,255,0.06), 0 30px 80px -40px rgba(0,0,0,0.9)',
        lift: '0 1px 0 0 rgba(255,255,255,0.14) inset, 0 50px 120px -40px rgba(0,0,0,0.9), 0 0 50px -20px rgba(111,180,172,0.25)',
        'glow-teal': '0 0 46px -14px rgba(99,183,173,0.42)',
        'glow-iris': '0 0 46px -14px rgba(142,138,214,0.42)',
        'glow-amber': '0 0 46px -14px rgba(214,164,92,0.4)',
        'glow-coral': '0 0 46px -14px rgba(220,130,121,0.4)',
        'glow-sky': '0 0 46px -14px rgba(110,155,209,0.4)',
        'glow-steel': '0 0 44px -14px rgba(132,151,174,0.35)',
      },
      transitionTimingFunction: {
        pop: 'cubic-bezier(0.22, 1, 0.36, 1)',
        glass: 'cubic-bezier(0.4, 0.14, 0.3, 1)',
      },
      keyframes: {
        driftA: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(4%, -3%, 0) scale(1.08)' },
        },
        driftB: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1.04)' },
          '50%': { transform: 'translate3d(-5%, 4%, 0) scale(0.96)' },
        },
        sheen: {
          '0%': { transform: 'translateX(-120%) skewX(-18deg)' },
          '100%': { transform: 'translateX(220%) skewX(-18deg)' },
        },
        breathe: {
          '0%,100%': { opacity: '0.55' },
          '50%': { opacity: '0.9' },
        },
      },
      animation: {
        'drift-a': 'driftA 26s ease-in-out infinite',
        'drift-b': 'driftB 32s ease-in-out infinite',
        breathe: 'breathe 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
