/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				copper: {
					DEFAULT: '#b87333',
					dark: '#8b5a2b',
					light: '#d4a574'
				}
			},
			fontFamily: {
				mono: ['JetBrains Mono', 'Courier New', 'monospace']
			}
		}
	},
	plugins: []
};
