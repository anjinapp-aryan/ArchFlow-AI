import * as z from "zod/mini";
const Node = z.strictObject({ id: z.string().check(z.minLength(1)), x: z.number(), y: z.number(), w: z.number().check(z.positive()), h: z.number().check(z.positive()) });
const Edge = z.strictObject({ id: z.string().check(z.minLength(1)), from: z.string(), to: z.string() });
const S = z.strictObject({ nodes: z.array(Node).check(z.maxLength(500)), edges: z.array(Edge) });
const r = S.safeParse({ nodes: [{ id: "a", x: 0, y: 0, w: -1, h: 5 }], edges: [{ id: "e", from: "a" }] });
console.log(JSON.stringify({ ok: r.success, n: r.error?.issues.length }));
