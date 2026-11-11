import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/socket.io": {
        target: "http://127.0.0.1:8080",
        ws: true,
      },
      "/display": "http://127.0.0.1:8080",
      "/display-assets": "http://127.0.0.1:8080",
      "/fonts": "http://127.0.0.1:8080",
      "/icon.svg": "http://127.0.0.1:8080",
      "/obs-main": "http://127.0.0.1:8080",
      "/obs-mainfull": "http://127.0.0.1:8080",
      "/obs-stage": "http://127.0.0.1:8080",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
