import { createRequire } from "node:module";
const require = createRequire("g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/upstream/animated-diagrams-skill/package.json");
const puppeteer = require("puppeteer-core");
const exe = process.env.USERPROFILE + "/.cache/hyperframes/chrome/chrome-headless-shell/win64-131.0.6778.85/chrome-headless-shell-win64/chrome-headless-shell.exe";
const [,, url, outPrefix] = process.argv;
const b = await puppeteer.launch({ executablePath: exe, headless: "shell", args:["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({width:1200,height:520});
const errs=[]; p.on("pageerror", e=>errs.push(String(e))); p.on("console", m=>{ if(m.type()==="error") errs.push(m.text()); });
await p.goto(url); await new Promise(r=>setTimeout(r,1500));
const info = await p.evaluate(()=>({ctrls:[...document.querySelectorAll('button,input[type=range]')].map(e=>e.tagName+':'+(e.getAttribute('aria-label')||e.title||e.className)), canvas: !!document.querySelector('canvas')}));
console.log(JSON.stringify(info));
for (const t of [0,5500,6500,9000,12000]) {
  await p.evaluate((t)=>window.postMessage({type:'ad-player',action:'seek',time:t},'*'), t);   // protocol guess; check below
  await new Promise(r=>setTimeout(r,400));
  await p.screenshot({path: outPrefix + "-seek" + t + ".png"});
}
// range slider seek
const slider = await p.$('input[type=range]');
if (slider) { await p.evaluate(()=>{const r=document.querySelector('input[type=range]'); r.value=7000; r.dispatchEvent(new Event('input',{bubbles:true}));}); await new Promise(r=>setTimeout(r,300)); await p.screenshot({path: outPrefix + "-slider7000.png"}); }
console.log("errors:", JSON.stringify(errs));
await b.close();
