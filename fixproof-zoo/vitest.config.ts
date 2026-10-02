import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["app/src/**/*.test.ts", "harness/src/**/*.test.ts"], testTimeout: 30000 } });
