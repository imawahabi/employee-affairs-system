/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1f2937',
          900: '#0f172a'
        }
      },
      keyframes: {
        'loading-bar': {
          '0%': { width: '0%', 'margin-left': '0%' },
          '50%': { width: '75%', 'margin-left': '12.5%' },
          '100%': { width: '0%', 'margin-left': '100%' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'float-particle': {
          '0%, 100%': { transform: 'translateY(0px) translateX(0px) scale(1)', opacity: '0.2' },
          '25%': { transform: 'translateY(-20px) translateX(10px) scale(1.2)', opacity: '0.4' },
          '50%': { transform: 'translateY(-10px) translateX(-5px) scale(0.8)', opacity: '0.6' },
          '75%': { transform: 'translateY(-30px) translateX(15px) scale(1.1)', opacity: '0.3' },
        },
      },
      animation: {
        'loading-bar': 'loading-bar 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'float-particle': 'float-particle 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
