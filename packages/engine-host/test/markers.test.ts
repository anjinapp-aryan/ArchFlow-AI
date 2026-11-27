import { describe, expect, it } from "vitest";
import { portMarkerKeys } from "../src/painter.ts";

describe("port markers hidden by the painter", () => {
  it("lists every port position of the document", () => {
    const keys = portMarkerKeys(
      JSON.stringify({
        nodes: [
          { x: 10, y: 20, ports: [{ dx: 104, dy: 45 }] },
          { x: 0, y: 0 },
          { x: 5.25, y: 1, ports: [{ dx: 0, dy: -4 }] },
        ],
      }),
    );
    expect([...keys]).toEqual(["456,260", "21,-12"]);
  });
  it("ignores input that is not an engine document", () => {
    expect(portMarkerKeys("not json").size).toBe(0);
  });
});
