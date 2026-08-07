import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    fs: {
      // The audit pipeline imports engine/ and sat-client/ source directly via relative
      // paths (frontend/src/lib/audit.ts) rather than through npm workspace package
      // linking (neither package publishes compiled output; both run straight off .ts,
      // same as their own test suites) -- Vite's dev server otherwise refuses to serve
      // files outside its project root (server.fs.strict, on by default since Vite 3).
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname, "./node_modules")],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
