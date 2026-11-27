import { z } from "zod";
const Node = z.strictObject({ id: z.string().min(1), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const Edge = z.strictObject({ id: z.string().min(1), from: z.string(), to: z.string() });
const S = z.strictObject({ nodes: z.array(Node).max(500), edges: z.array(Edge) });
const bad = { nodes: [{ id: "a", x: 0, y: 0, w: -1, h: 5 }], edges: [{ id: "e", from: "a" }] };
const r = S.safeParse(bad);
console.log(JSON.stringify({ ok: r.success, issues: r.error?.issues.map((i) => ({ code: i.code, path: i.path.join("/") })), json_schema: typeof z.toJSONSchema === "function" }));
