/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const controlTarget = process.env.SM_CONTROL_URL ?? "https://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: controlTarget,
        secure: false,
      },
      "/socket.io": {
        target: controlTarget,
        secure: false,
        ws: true,
      },
      "/display": {
        target: controlTarget,
        secure: false,
        ws: true,
      },
      "/icon.svg": {
        target: controlTarget,
        secure: false,
      },
      "/obs-main": {
        target: controlTarget,
        secure: false,
      },
      "/obs-mainfull": {
        target: controlTarget,
        secure: false,
      },
      "/obs-stage": {
        target: controlTarget,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
