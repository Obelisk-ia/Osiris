import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

// ESM config for the current Vite/Vitest runtime.
export default defineConfig({
  plugins: [{
    name: "convex-wasm-modules",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(".wasm")) return;
      // Convex imports WASM as a compiled module (not instantiated exports).
      // Mirror that in tests so Auth uses its real Argon2 implementation.
      const base64 = readFileSync(id).toString("base64");
      return `export default new WebAssembly.Module(Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0)));`;
    },
  }],
  test: {
    include: ["convex/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test", "password-hash-wasm"] } },
  },
});
