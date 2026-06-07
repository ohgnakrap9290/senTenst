import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ["Safari >= 13", "iOS >= 13"],
      modernPolyfills: true,
    }),
  ],
});
