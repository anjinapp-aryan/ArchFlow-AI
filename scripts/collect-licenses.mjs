#!/usr/bin/env node
// Collects the full licence texts of everything compiled into the engine WebAssembly artifact
// into licenses/, straight from the pinned sources/toolchain (no hand-copied text), and writes
// licenses/MANIFEST.json with SHA-256 of each file. Fails if any source is missing.
//
// Run after `npm run engine:build`. CI fails if licenses/ differs from a fresh collection.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "licenses");
const emscripten = join(root, ".tools", "emsdk", "upstream", "emscripten");
const lib = join(emscripten, "system", "lib");
const deps = join(root, "build", "engine", "cmake", "_deps");
const upstream = join(root, ".cache", "upstream", "AnimatedDiagrams");

/** [output name, source file, what it covers] */
const items = [
  [
    "AnimatedDiagrams-MIT.txt",
    join(upstream, "LICENSE"),
    "AnimatedDiagrams engine (ad_engine, Player.cpp)",
  ],
  ["nlohmann-json-MIT.txt", join(deps, "nlohmann_json-src", "LICENSE.MIT"), "nlohmann/json 3.11.3"],
  [
    "Emscripten-MIT-NCSA.txt",
    join(emscripten, "LICENSE"),
    "Emscripten runtime glue, libemmalloc, libemcc, libc glue (emscripten_*.c)",
  ],
  ["Emscripten-AUTHORS.txt", join(emscripten, "AUTHORS"), "Emscripten copyright holders"],
  [
    "musl-COPYRIGHT.txt",
    join(lib, "libc", "musl", "COPYRIGHT"),
    "musl libc (MIT + listed permissive third-party parts) -> libc.a / libc_optz.a members",
  ],
  [
    "LLVM-libcxx-Apache-2.0-with-LLVM-exception.txt",
    join(lib, "libcxx", "LICENSE.TXT"),
    "libc++ headers instantiated in the engine (std::string, vector, ...)",
  ],
  [
    "LLVM-libunwind-Apache-2.0-with-LLVM-exception.txt",
    join(lib, "libunwind", "LICENSE.TXT"),
    "libunwind-legacyexcept.a (Unwind-wasm.o)",
  ],
  [
    "LLVM-compiler-rt-Apache-2.0-with-LLVM-exception.txt",
    join(lib, "compiler-rt", "LICENSE.TXT"),
    "libclang_rt.builtins.a members",
  ],
  [
    "LLVM-llvm-libc-Apache-2.0-with-LLVM-exception.txt",
    join(lib, "llvm-libc", "LICENSE.TXT"),
    "llvm-libc sources in the Emscripten sysroot (not observed in the link map; kept for completeness)",
  ],
];

// npm packages that ship inside ArchFlow's browser bundles (importers + validator).
const nm = join(root, "node_modules");
items.push(
  ["zod-MIT.txt", join(nm, "zod", "LICENSE"), "zod 4.6.7 (zod/mini) - canonical model validation"],
  [
    "saxes-ISC.txt",
    join(root, "scripts", "license-sources", "saxes-6.0.0-LICENSE.txt"),
    "saxes 6.0.0 - XML parser in the draw.io importer (the npm tarball has no LICENSE file; text taken from the repository at the published gitHead 211fa0eb, see scripts/license-sources/README.md)",
  ],
  ["xmlchars-MIT.txt", join(nm, "xmlchars", "LICENSE"), "xmlchars 2.2.0 - dependency of saxes"],
  [
    "dagre-MIT.txt",
    join(nm, "@dagrejs", "dagre", "LICENSE"),
    "@dagrejs/dagre 3.1.3 - Mermaid flowchart layout",
  ],
  [
    "webm-muxer-MIT.txt",
    join(nm, "webm-muxer", "LICENSE"),
    "webm-muxer 5.1.4 - WebM export in the web app",
  ],
  [
    "mp4-muxer-MIT.txt",
    join(nm, "mp4-muxer", "LICENSE"),
    "mp4-muxer 5.2.2 - MP4 export in the web app",
  ],
  [
    "graphlib-MIT.txt",
    join(nm, "@dagrejs", "graphlib", "LICENSE"),
    "@dagrejs/graphlib 4.0.6 - dependency of dagre",
  ],
);

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
mkdirSync(outDir, { recursive: true });
const missing = items.filter(([, src]) => !existsSync(src));
if (missing.length) {
  console.error(
    "[licenses] missing sources (run `npm run engine:build` first):\n  " +
      missing.map(([, s]) => s).join("\n  "),
  );
  process.exit(1);
}

// nanosvg: the licence is the header comment of nanosvg.h itself (zlib licence + attribution notes).
const nano = readFileSync(join(deps, "nanosvg-src", "nanosvg.h"), "utf8");
const end = nano.indexOf("*/");
if (!nano.startsWith("/*") || end < 0) {
  console.error("[licenses] unexpected nanosvg.h header layout");
  process.exit(1);
}
const nanoText =
  nano
    .slice(0, end + 2)
    .replace(/^\/\*\n?|\n?\*\/$/g, "")
    .replace(/^ \* ?/gm, "") + "\n";
writeFileSync(join(outDir, "nanosvg-Zlib.txt"), nanoText);

const manifest = {};
for (const [name, src, covers] of items) {
  copyFileSync(src, join(outDir, name));
  manifest[name] = { sha256: sha(join(outDir, name)), covers };
}
manifest["nanosvg-Zlib.txt"] = {
  sha256: sha(join(outDir, "nanosvg-Zlib.txt")),
  covers:
    "nanosvg.h (header-only, compiled into ad_engine); also credits AGG 2.4 and canvg-derived code",
};

// engine link inventory (which archive members were linked), copied for audit
const inputs = join(root, "build", "engine", "link-inputs.txt");
if (existsSync(inputs)) {
  copyFileSync(inputs, join(outDir, "ENGINE_LINK_INPUTS.txt"));
  manifest["ENGINE_LINK_INPUTS.txt"] = {
    sha256: sha(join(outDir, "ENGINE_LINK_INPUTS.txt")),
    covers: "archive members linked into the WASM (wasm-ld map)",
  };
}
writeFileSync(join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[licenses] collected ${Object.keys(manifest).length} files into licenses/`);
