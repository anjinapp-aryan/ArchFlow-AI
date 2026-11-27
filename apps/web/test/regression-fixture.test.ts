import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepare } from "../src/pipeline.ts";

/**
 * fixtures/scenarios/aws-alb.canonical.json is the golden-frame input for the AWS ALB regression
 * diagram. It must stay exactly what the pipeline produces from fixtures/regression/aws-alb.txt,
 * so any change to layout, routing, connector semantics or health checks shows up here first.
 * Intentional change: ARCHFLOW_REGRESSION_UPDATE=1 npx vitest run apps/web/test/regression-fixture.test.ts
 * then `npm run golden:update`, and review both diffs.
 */
const root = new URL("../../../fixtures/", import.meta.url);

describe("regression fixture is current", () => {
  it("aws-alb.canonical.json = pipeline(aws-alb.txt)", async () => {
    const r = await prepare("text", readFileSync(new URL("regression/aws-alb.txt", root), "utf8"));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const want = JSON.stringify(r.document, null, 2) + "\n";
    const file = new URL("scenarios/aws-alb.canonical.json", root);
    if (process.env["ARCHFLOW_REGRESSION_UPDATE"] === "1") writeFileSync(file, want);
    expect(readFileSync(file, "utf8")).toBe(want);
  });
});
