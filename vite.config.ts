import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


export default defineConfig({
	plugins: [react()],
	build: {
		// Increase the chunk size warning limit to reduce noisy warnings during large builds.
		// Value is in kilobytes (e.g., 1500 = 1.5 MB).
		chunkSizeWarningLimit: 1500,
	},
})