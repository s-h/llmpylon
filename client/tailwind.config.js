export default {
    content: [
        "./index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'surface-primary': 'var(--color-surface-primary)',
                'surface-card': 'var(--color-surface-card)',
                'surface-elevated': 'var(--color-surface-elevated)',
                'surface-overlay': 'var(--color-surface-overlay)',
                'surface-sidebar': 'var(--color-surface-sidebar)',
                'surface-input': 'var(--color-surface-input)',
                'text-primary': 'var(--color-text-primary)',
                'text-secondary': 'var(--color-text-secondary)',
                'text-tertiary': 'var(--color-text-tertiary)',
                'border-primary': 'var(--color-border-default)',
                'border-hover': 'var(--color-border-hover)',
                accent: 'var(--color-accent)',
                'accent-soft': 'var(--color-accent-soft)',
                'accent-hover': 'var(--color-accent-hover)',
            },
            borderRadius: {
                'card': '14px',
                'btn': '9px',
                'input': '9px',
                'modal': '18px',
            },
            boxShadow: {
                'card': 'var(--shadow-card)',
                'glow': 'var(--shadow-glow)',
                'modal': 'var(--shadow-modal)',
            },
        },
    },
    plugins: [],
}
