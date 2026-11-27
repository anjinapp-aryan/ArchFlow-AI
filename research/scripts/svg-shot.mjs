import { createRequire } from "node:module";
const require = createRequire("g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/upstream/animated-diagrams-skill/package.json");
const puppeteer = require("puppeteer-core");
const exe = process.env.USERPROFILE + "/.cache/hyperframes/chrome/chrome-headless-shell/win64-131.0.6778.85/chrome-headless-shell-win64/chrome-headless-shell.exe";
const b = await puppeteer.launch({ executablePath: exe, headless: "shell" });
const p = await b.newPage(); await p.setViewport({width:1400,height:700});
await p.goto("file:///g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/benchmark/cogniflow/bench.svg_animated.svg"); await new Promise(r=>setTimeout(r,500));
for (const t of [0.5,1.5,3,4.5]) { await p.evaluate((t)=>{const s=document.documentElement; s.pauseAnimations(); s.setCurrentTime(t);}, t); await new Promise(r=>setTimeout(r,200)); await p.screenshot({path:"g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/benchmark/cogniflow/svg-t"+t+".png"}); }
await b.close();
