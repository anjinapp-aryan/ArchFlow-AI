import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Locate a Chrome/Chromium executable for headless QA. puppeteer-core downloads no browser.
 * Order: CHROME_EXE, CHROME_PATH, well-known install paths, HyperFrames' headless-shell cache
 * (developer convenience only). Throws with instructions if nothing is found.
 */
export function findChrome(): string {
  for (const v of ["CHROME_EXE", "CHROME_PATH"]) {
    const p = process.env[v];
    if (p) {
      if (!existsSync(p)) throw new Error(`${v} points to a missing file: ${p}`);
      return p;
    }
  }
  const candidates: string[] = [];
  if (process.platform === "win32") {
    for (const base of [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ])
      if (base) candidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }
  for (const c of candidates) if (existsSync(c)) return c;
  const cache = join(homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  if (existsSync(cache)) {
    for (const v of readdirSync(cache).sort().reverse()) {
      const dir = join(cache, v);
      for (const sub of readdirSync(dir)) {
        const exe = join(
          dir,
          sub,
          process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell",
        );
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error("No Chrome/Chromium found. Install Chrome or set CHROME_EXE to its executable.");
}
