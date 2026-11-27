import { readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
const S = 1.6, OX = 40, OY = 260;
const N = Object.fromEntries(spec.nodes.map(n => [n.id, { ...n, x: n.x*S+OX, y: n.y*S+OY, w: n.w*S, h: n.h*S }]));
const c = n => [n.x + n.w/2, n.y + n.h/2];
const edgePath = (a, b) => { const [x1,y1]=c(N[a]), [x2,y2]=c(N[b]); return `M${x1},${y1} L${x2},${y2}`; };
const colors = { request:"#38bdf8", response:"#4ade80", event:"#c084fc", error:"#f87171", retry:"#fbbf24", success:"#4ade80" };
let svg = "";
for (const e of spec.edges) svg += `<path id="edge-${e.id}" class="edge" d="${edgePath(e.from,e.to)}"/>`;
// reverse paths for response messages
const msgs = spec.scenario.steps.filter(s => s.type === "message");
msgs.forEach((m,i) => { svg += `<path id="mp-${i}" d="${edgePath(m.from,m.to)}" fill="none" stroke="none"/>`; });
for (const n of Object.values(N)) svg += `<g id="node-${n.id}" class="node"><rect id="r-${n.id}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="14"/><text x="${n.x+n.w/2}" y="${n.y+n.h/2+8}" text-anchor="middle">${n.label}</text></g>`;
msgs.forEach((m,i) => { svg += `<g id="pk-${i}" opacity="0"><circle r="11" fill="${colors[m.variant]||"#fff"}" filter="url(#glow)"/><text y="-20" text-anchor="middle" class="pl">${m.label||""}</text></g>`; });
const dur = spec.scenario.duration/1000;
let js = "";
msgs.forEach((m,i) => { const t=m.start/1000, d=m.duration/1000;
  js += `tl.set("#pk-${i}",{opacity:1},${t}).to("#pk-${i}",{motionPath:{path:"#mp-${i}",align:"#mp-${i}",alignOrigin:[0.5,0.5]},duration:${d},ease:"none"},${t}).set("#pk-${i}",{opacity:0},${t+d});\n`;
  js += `tl.to("#r-${m.to}",{stroke:"${colors[m.variant]}",strokeWidth:6,duration:0.2},${t+d-0.1}).to("#r-${m.to}",{stroke:"#475569",strokeWidth:2,duration:0.4},${t+d+0.2});\n`; });
for (const s of spec.scenario.steps.filter(s=>s.type==="state")) { const col = s.state==="down"?"#7f1d1d":s.state==="success"?"#14532d":"#1d4ed8"; const t=s.start/1000,d=s.duration/1000;
  js += `tl.to("#r-${s.nodeId}",{fill:"${col}",duration:0.25},${t}).to("#r-${s.nodeId}",{fill:"#1e293b",duration:0.25},${t+d});\n`; }
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="./vendor/gsap.min.js"></script><script src="./vendor/MotionPathPlugin.min.js"></script>
<style>html,body{margin:0;width:1920px;height:1080px;background:#0b1220;font-family:Arial,sans-serif}
.edge{fill:none;stroke:#64748b;stroke-width:2}.node rect{fill:#1e293b;stroke:#475569;stroke-width:2}.node text{fill:#e2e8f0;font-size:22px}.pl{fill:#e2e8f0;font-size:18px}
h1{position:absolute;left:40px;top:40px;margin:0;color:#e2e8f0;font-size:40px}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="1920" data-height="1080"><h1>${spec.meta.name}</h1>
<svg width="1920" height="1080" viewBox="0 0 1920 1080"><defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${svg}</svg></div>
<script>gsap.registerPlugin(MotionPathPlugin);const tl=gsap.timeline({paused:true});
${js}tl.to({},{duration:${dur}-tl.duration()>0?${dur}-0:0.01},0);
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;
if(!window.__hyperframes&&!navigator.webdriver){tl.play();}</script></body></html>`;
writeFileSync(out, html);
