/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F1419',
        panel: 'rgba(255,255,255,0.04)',
        stroke: 'rgba(255,255,255,0.10)',
        cyan: '#00D4FF',
        mint: '#00FF9C',
        amber: '#FFB800',
        rose: '#FF5C7A',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      transitionTimingFunction: {
        pop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
