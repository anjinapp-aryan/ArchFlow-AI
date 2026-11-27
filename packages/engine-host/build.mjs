// Bundles the browser entry into dist/engine-host.iife.js (esbuild, MIT).
import { build } from "esbuild";
await build({
  entryPoints: ["src/browser-entry.ts"],
  bundle: true,
  format: "iife",
  globalName: "ArchFlowEngineHost",
  target: "es2023",
  outfile: "dist/engine-host.iife.js",
  legalComments: "none",
  logLevel: "info",
});
