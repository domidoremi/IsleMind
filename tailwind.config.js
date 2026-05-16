/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: 'var(--color-surface)',
        surfaceSecondary: 'var(--color-surfaceSecondary)',
        surfaceTertiary: 'var(--color-surfaceTertiary)',
        primary: 'var(--color-primary)',
        primaryForeground: 'var(--color-primaryForeground)',
        secondary: 'var(--color-secondary)',
        accent: 'var(--color-accent)',
        border: 'var(--color-border)',
        borderStrong: 'var(--color-borderStrong)',
        text: 'var(--color-text)',
        textSecondary: 'var(--color-textSecondary)',
        textTertiary: 'var(--color-textTertiary)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        backdrop: 'var(--color-backdrop)',
      },
      borderRadius: {
        soft: '1.75rem',
      },
    },
  },
  plugins: [],
}
