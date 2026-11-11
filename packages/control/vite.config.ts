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
      "/display": {
        target: "http://127.0.0.1:8080",
        ws: true,
      },
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
