import { compile, exportGraph } from "g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/upstream/CogniFlow/src/lib/studio/headless";
import { writeFileSync } from "fs";
const out = "g:/CLAUDE_WORK_SPACE/ArchFlow AI/research/benchmark/cogniflow";
const text = `Order flow:
User -> API Gateway : HTTPS request
API Gateway -> Authentication Service : validate token
Authentication Service -> Order Service : authorized
Order Service -> Kafka : publish OrderCreated
Kafka -> Consumer : consume
Consumer -> PostgreSQL : write order
PostgreSQL -> Consumer : ack
Consumer -> Order Service : result
Order Service -> API Gateway : response
API Gateway -> User : 201 Created`;
const t0 = performance.now();
const r = compile({ text });
console.log("compile ms", (performance.now()-t0).toFixed(1), "nodes", r.graph.nodes.length, "edges", r.graph.edges.length, "issues", JSON.stringify(r.issues), "warn", r.warnings);
console.log(r.graph.nodes.map(n=>n.label+":"+n.type).join(" | "));
console.log(r.graph.edges.map(e=>e.semantic_type+(e.label?"("+e.label+")":"")).join(" | "));
console.log("story", r.story.length);
for (const f of ["air","mermaid","drawio","svg","svg_animated"] as const) {
  const t=performance.now(); const x:any = exportGraph(r.graph, f as any);
  const s = typeof x==="string"?x:(x.content ?? x.text ?? JSON.stringify(x));
  writeFileSync(`${out}/bench.${f}.${f==="air"?"json":f==="mermaid"?"mmd":f==="drawio"?"drawio":"svg"}`, s);
  console.log(f, s.length, "bytes", (performance.now()-t).toFixed(1),"ms");
}
