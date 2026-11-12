import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://127.0.0.1:8080",
        secure: false,
      },
      "/socket.io": {
        target: "https://127.0.0.1:8080",
        secure: false,
        ws: true,
      },
      "/display": {
        target: "https://127.0.0.1:8080",
        secure: false,
        ws: true,
      },
      "/icon.svg": {
        target: "https://127.0.0.1:8080",
        secure: false,
      },
      "/obs-main": {
        target: "https://127.0.0.1:8080",
        secure: false,
      },
      "/obs-mainfull": {
        target: "https://127.0.0.1:8080",
        secure: false,
      },
      "/obs-stage": {
        target: "https://127.0.0.1:8080",
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
