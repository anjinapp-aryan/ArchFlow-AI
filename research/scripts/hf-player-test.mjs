import { createRequire } from "node:module";
const require = createRequire("g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/upstream/animated-diagrams-skill/package.json");
const puppeteer = require("puppeteer-core");
const exe = process.env.USERPROFILE + "/.cache/hyperframes/chrome/chrome-headless-shell/win64-131.0.6778.85/chrome-headless-shell-win64/chrome-headless-shell.exe";
const b = await puppeteer.launch({ executablePath: exe, headless: "shell" });
const p = await b.newPage(); await p.setViewport({width:1280,height:720});
const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.goto("file:///g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/benchmark/hyperframes-gsap/renders/hyperframes-gsap.interactive.html"); await new Promise(r=>setTimeout(r,800));
console.log(JSON.stringify(await p.evaluate(()=>({ctrls:[...document.querySelectorAll('button,input')].map(e=>e.tagName+':'+(e.type||'')+':'+(e.textContent||e.title||'').slice(0,12))}))));
const t0 = await p.evaluate(()=>window.__timelines&&window.__timelines.main?window.__timelines.main.time():-1);
await new Promise(r=>setTimeout(r,1000));
const t1 = await p.evaluate(()=>window.__timelines.main.time());
console.log("autoplay advances:", t0, "->", t1);
const r = await p.$('input[type=range]');
if (r) { await p.evaluate(()=>{const e=document.querySelector('input[type=range]'); e.value=e.max*0.45; e.dispatchEvent(new Event('input',{bubbles:true}));}); await new Promise(r=>setTimeout(r,300)); console.log("after scrub time:", await p.evaluate(()=>window.__timelines.main.time()), "paused:", await p.evaluate(()=>window.__timelines.main.paused())); }
console.log("errors:", JSON.stringify(errs)); await b.close();
