/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          500: '#10b981',
          600: '#059669',
          900: '#064e3b',
        },
        dark: {
          bg: '#0a0d14',
          card: '#121824',
          border: '#1e293b',
          muted: '#64748b'
        }
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
      },
      boxShadow: {
        'glow-emerald': '0 0 25px -5px rgba(16, 185, 129, 0.3)',
        'glow-indigo': '0 0 25px -5px rgba(99, 102, 241, 0.3)',
      }
    },
  },
  plugins: [],
};
