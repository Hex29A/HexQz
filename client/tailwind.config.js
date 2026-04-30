/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent, #6366f1)',
        'bg-primary': 'var(--bg-primary, #0f172a)',
        'bg-secondary': 'var(--bg-secondary, #1e293b)',
        'bg-card': 'var(--bg-card, #1e293b)',
        'text-primary': 'var(--text-primary, #f1f5f9)',
        'text-secondary': 'var(--text-secondary, #94a3b8)',
        'border-theme': 'var(--border, #334155)',
      },
      borderRadius: {
        'theme': 'var(--radius, 0.75rem)',
      }
    }
  },
  plugins: []
};
