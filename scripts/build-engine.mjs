#!/usr/bin/env node
// Reproducible build of the AnimatedDiagrams engine core (ad_engine) to WebAssembly.
//
//   node scripts/build-engine.mjs                 build (installs toolchain into .tools/ on first run)
//   node scripts/build-engine.mjs --verify-only   only compare build/engine/manifest.json to engine/expected-hashes.json
//   node scripts/build-engine.mjs --update-expected   record this platform's hashes (deliberate act, review the diff)
//   node scripts/build-engine.mjs --src <dir>     use an existing clone (must be at the pinned revision)
//   node scripts/build-engine.mjs --emsdk <dir>   use an existing emsdk (must be at the pinned emscripten version)
//   node scripts/build-engine.mjs --out <dir>     output dir (default build/engine)
//
// Everything is pinned in engine/upstream.lock.json. Works on Windows (cmd), Linux and macOS.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "engine", "upstream.lock.json"), "utf8"));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const isWin = process.platform === "win32";

const srcDir = resolve(opt("--src", join(root, ".cache", "upstream", lock.upstream.name)));
const emsdkDir = resolve(opt("--emsdk", join(root, ".tools", "emsdk")));
const pyDir = join(root, ".tools", "pylibs");
const outDir = resolve(opt("--out", join(root, "build", "engine")));
const cmakeBuildDir = join(outDir, "cmake");
const expectedFile = join(root, "engine", "expected-hashes.json");
const platformKey = `${process.platform}-${process.arch}`;

const log = (...a) => console.log("[engine]", ...a);
const die = (m) => {
  console.error("[engine] ERROR:", m);
  process.exit(1);
};
const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

// emsdk decides between cmd and POSIX output by looking for MSYS (Git Bash sets MSYSTEM); strip it
// so that emsdk_env.bat emits cmd syntax even when this script is launched from Git Bash.
function cleanEnv(extra = {}) {
  const e = { ...process.env, PYTHONUTF8: "1", ...extra };
  if (isWin) for (const k of ["MSYSTEM", "MSYS", "MINGW_PREFIX", "MSYSCON"]) delete e[k];
  return e;
}

function run(cmd, args, o = {}) {
  if (isWin && /.(bat|cmd)$/i.test(cmd)) {
    // Node refuses to spawn .bat/.cmd directly; go through cmd.exe with verbatim quoting.
    args = [
      "/d",
      "/s",
      "/c",
      `"${[cmd, ...args].map((a) => (/[s"]/.test(a) ? `"${a}"` : a)).join(" ")}"`,
    ];
    cmd = "cmd.exe";
    o = { ...o, verbatim: true };
  }
  const r = spawnSync(cmd, args, {
    windowsVerbatimArguments: !!o.verbatim,
    stdio: o.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: cleanEnv(o.env),
    cwd: o.cwd,
    shell: false,
  });
  if (o.allowFail) return r;
  if (r.error || r.status !== 0)
    die(`${cmd} ${args.join(" ")} failed (status ${r.status}) ${r.error ?? ""}\n${r.stderr ?? ""}`);
  return r;
}

// Windows: the `python3` on PATH is often the Microsoft Store stub (exit 49). Probe for a real one.
function findPython() {
  for (const c of [["python3"], ["python"], ["py", "-3"]]) {
    const r = spawnSync(c[0], [...c.slice(1), "--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0 && /^Python 3\./.test((r.stdout || r.stderr || "").trim()))
      return c;
  }
  die(
    "no working Python 3 found (python3 / python / py -3). On Windows, install Python 3 and disable the Store alias.",
  );
}

function verify() {
  const mf = join(outDir, "manifest.json");
  if (!existsSync(mf)) die(`no ${mf}; run the build first`);
  const m = JSON.parse(readFileSync(mf, "utf8"));
  const expected = existsSync(expectedFile) ? JSON.parse(readFileSync(expectedFile, "utf8")) : {};
  const want = expected[platformKey];
  if (!want) {
    log(`WARNING: no expected hashes recorded for platform "${platformKey}". Not verified.`);
    log("  Observed:", JSON.stringify(m.artifacts));
    log("  Record deliberately with --update-expected after review.");
    return "unrecorded";
  }
  for (const k of Object.keys(want)) {
    if (m.artifacts[k]?.sha256 !== want[k]) {
      die(
        `hash mismatch for ${k} on ${platformKey}: expected ${want[k]}, got ${m.artifacts[k]?.sha256}`,
      );
    }
  }
  log(`verified ${Object.keys(want).length} artifact hashes for ${platformKey}`);
  return "verified";
}

if (flag("--verify-only")) {
  verify();
  process.exit(0);
}

// 1. upstream source at the pinned revision
if (!existsSync(join(srcDir, ".git"))) {
  log(`cloning ${lock.upstream.repo} -> ${srcDir}`);
  mkdirSync(dirname(srcDir), { recursive: true });
  run("git", ["clone", "--quiet", lock.upstream.repo, srcDir]);
  run("git", ["-C", srcDir, "checkout", "--quiet", lock.upstream.revision]);
}
const head = run("git", ["-C", srcDir, "rev-parse", "HEAD"], { capture: true }).stdout.trim();
if (head !== lock.upstream.revision) die(`upstream at ${head}, pinned ${lock.upstream.revision}`);
const dirty = run("git", ["-C", srcDir, "status", "--porcelain", "--untracked-files=no"], {
  capture: true,
}).stdout.trim();
if (dirty) die(`upstream tree has local modifications:\n${dirty}`);
log("upstream", lock.upstream.tag, head);

// 2. toolchain (emsdk + cmake/ninja wheels)
const py = findPython();
log("python:", py.join(" "));
if (!existsSync(join(emsdkDir, "emsdk.py"))) {
  log("cloning emsdk");
  mkdirSync(dirname(emsdkDir), { recursive: true });
  run("git", ["clone", "--quiet", lock.toolchain.emsdk.repo, emsdkDir]);
  run("git", ["-C", emsdkDir, "checkout", "--quiet", lock.toolchain.emsdk.revision]);
}
const emsdkCmd = join(emsdkDir, isWin ? "emsdk.bat" : "emsdk");
const emVer = lock.toolchain.emsdk.emscripten;
if (!existsSync(join(emsdkDir, "upstream", "emscripten", isWin ? "emcc.bat" : "emcc"))) {
  log(`installing emscripten ${emVer} (large download, once)`);
  run(emsdkCmd, ["install", emVer], { cwd: emsdkDir });
  run(emsdkCmd, ["activate", emVer], { cwd: emsdkDir });
}
if (!existsSync(join(pyDir, "bin"))) {
  log("installing cmake + ninja wheels");
  run(py[0], [
    ...py.slice(1),
    "-m",
    "pip",
    "install",
    "--quiet",
    "--target",
    pyDir,
    `cmake==${lock.toolchain.python.cmake}`,
    `ninja==${lock.toolchain.python.ninja}`,
  ]);
}

// 3. build in a generated script that first activates the emsdk environment
rmSync(cmakeBuildDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); // Windows: indexers/AV may briefly hold handles
mkdirSync(outDir, { recursive: true });
const q = (p) => `"${p}"`;
// Linker map (relative path: the build dir may contain spaces). Does not change the output (verified by hash);
// it is used to inventory which libc/compiler-rt/unwinder objects end up in the WASM (licence notices).
const MAP_FLAG = isWin
  ? '"-DCMAKE_EXE_LINKER_FLAGS=-Wl,-Map,link.map"'
  : "-DCMAKE_EXE_LINKER_FLAGS=-Wl,-Map,link.map";
let script;
if (isWin) {
  script = join(outDir, "run-build.cmd");
  writeFileSync(
    script,
    [
      "@echo off",
      // NB: neither redirect this call nor set EMSDK_QUIET: either makes emsdk_env.bat fail to export PATH on Windows.
      `call ${q(join(emsdkDir, "emsdk_env.bat"))}`,
      `set "PATH=${join(pyDir, "bin")};%PATH%"`,
      `set "PYTHONPATH=${pyDir}"`,
      "set PYTHONUTF8=1",
      `call emcmake cmake -S ${q(srcDir)} -B ${q(cmakeBuildDir)} -G Ninja ${MAP_FLAG} || exit /b 1`,
      `cmake --build ${q(cmakeBuildDir)} || exit /b 1`,
      "",
    ].join("\r\n"),
  );
  run("cmd.exe", ["/d", "/c", script]);
} else {
  script = join(outDir, "run-build.sh");
  writeFileSync(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `source ${q(join(emsdkDir, "emsdk_env.sh"))} >/dev/null 2>&1`,
      `export PATH=${q(join(pyDir, "bin"))}:"$PATH" PYTHONPATH=${q(pyDir)} PYTHONUTF8=1`,
      `emcmake cmake -S ${q(srcDir)} -B ${q(cmakeBuildDir)} -G Ninja ${MAP_FLAG}`,
      `cmake --build ${q(cmakeBuildDir)}`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  run("bash", [script]);
}

// 4. collect + hash artifacts
const engineJs = join(cmakeBuildDir, lock.artifacts.engineJs);
const template = join(cmakeBuildDir, lock.artifacts.playerTemplate);
for (const f of [engineJs, template]) if (!existsSync(f)) die(`missing build output ${f}`);
copyFileSync(engineJs, join(outDir, "ad_player_engine.js"));
copyFileSync(template, join(outDir, "player-template.html"));
// link inventory: archive members linked into the WASM
const mapFile = join(cmakeBuildDir, "link.map");
if (existsSync(mapFile)) {
  const re = /([A-Za-z0-9_+.-]+\.a)\(([^)]+)\)/g;
  const members = [
    ...new Set([...readFileSync(mapFile, "utf8").matchAll(re)].map((m) => `${m[1]}(${m[2]})`)),
  ].sort();
  writeFileSync(join(outDir, "link-inputs.txt"), members.join("\n") + "\n");
  log(`link inventory: ${members.length} archive members -> link-inputs.txt`);
}
const manifest = {
  upstream: lock.upstream,
  emscripten: emVer,
  platform: platformKey,
  artifacts: {
    "ad_player_engine.js": {
      sha256: sha256(join(outDir, "ad_player_engine.js")),
      bytes: readFileSync(join(outDir, "ad_player_engine.js")).length,
    },
    "player-template.html": {
      sha256: sha256(join(outDir, "player-template.html")),
      bytes: readFileSync(join(outDir, "player-template.html")).length,
    },
  },
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
log("built:", JSON.stringify(manifest.artifacts));

if (flag("--update-expected")) {
  const expected = existsSync(expectedFile) ? JSON.parse(readFileSync(expectedFile, "utf8")) : {};
  expected[platformKey] = Object.fromEntries(
    Object.entries(manifest.artifacts).map(([k, v]) => [k, v.sha256]),
  );
  writeFileSync(expectedFile, JSON.stringify(expected, null, 2) + "\n");
  log(`recorded expected hashes for ${platformKey} in engine/expected-hashes.json`);
}
verify();
