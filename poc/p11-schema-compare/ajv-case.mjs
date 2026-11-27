import Ajv from "ajv";
const node = { type: "object", additionalProperties: false, required: ["id","x","y","w","h"], properties: { id: { type: "string", minLength: 1 }, x: { type: "number" }, y: { type: "number" }, w: { type: "number", exclusiveMinimum: 0 }, h: { type: "number", exclusiveMinimum: 0 } } };
const edge = { type: "object", additionalProperties: false, required: ["id","from","to"], properties: { id: { type: "string", minLength: 1 }, from: { type: "string" }, to: { type: "string" } } };
const schema = { type: "object", additionalProperties: false, required: ["nodes","edges"], properties: { nodes: { type: "array", maxItems: 500, items: node }, edges: { type: "array", items: edge } } };
const bad = { nodes: [{ id: "a", x: 0, y: 0, w: -1, h: 5 }], edges: [{ id: "e", from: "a" }] };
const ajv = new Ajv({ allErrors: true });
const v = ajv.compile(schema);
console.log(JSON.stringify({ ok: v(bad), issues: v.errors?.map((e) => ({ keyword: e.keyword, path: e.instancePath })) }));
