import { deflateRawSync } from "node:zlib";

/**
 * P1.3 importer-fidelity corpus: the single source of truth for every file under
 * `fixtures/diagrams/`. Each entry is a ground-truth diagram; `renderDrawio` and
 * `renderMermaid` produce the files, and the ground truth (`*.truth.json`) is the entry itself.
 *
 * HONEST LIMIT: these files are authored by us following the structure real draw.io / Mermaid
 * files have (style strings, container parents, relative child geometry, compressed pages).
 * They are not a sample of the wild; results are evidence about these shapes only.
 */

export type Direction = "forward" | "backward" | "both" | "none";
export type Stroke = "solid" | "dashed";
export type Routing = "straight" | "curved" | "orthogonal";

export interface CNode {
  key: string;
  /** Unique within an entry: importers are matched by label. */
  label: string;
  /** Absolute diagram coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  group?: string;
}
export interface CGroup {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  parent?: string;
}
export interface CEdge {
  key: string;
  from: string;
  to: string;
  label?: string;
  /** `forward` = arrowhead at `to`; `backward` = arrowhead at `from` only. */
  direction: Direction;
  stroke: Stroke;
  routing: Routing;
}
export type MermaidKind = "flowchart" | "sequence";
export interface CorpusEntry {
  id: string;
  title: string;
  categories: string[];
  nodes: CNode[];
  groups: CGroup[];
  edges: CEdge[];
  /** Number of connectors drawn with a missing end (draw.io only); they must NOT become edges. */
  danglingEdges: number;
  formats: {
    drawio: boolean;
    mermaid: MermaidKind | false;
    drawioCompressed?: boolean;
    /** Explicit PlantUML variant; generated entries get one automatically (see plantumlKind). */
    plantuml?: "component" | "sequence";
  };
  /** Edge keys that Mermaid cannot express (left out of the Mermaid file and its ground truth). */
  mermaidExclude?: string[];
  /**
   * Hand-written source text used verbatim instead of the generated file. For these entries the
   * ground truth is written by hand from the source's documented semantics.
   */
  raw?: { drawio?: string; mermaid?: string; plantuml?: string };
}

const n = (
  key: string,
  label: string,
  x: number,
  y: number,
  w = 120,
  h = 60,
  group?: string,
): CNode => ({
  key,
  label,
  x,
  y,
  w,
  h,
  ...(group ? { group } : {}),
});
const e = (
  key: string,
  from: string,
  to: string,
  label?: string,
  extra: Partial<Pick<CEdge, "direction" | "stroke" | "routing">> = {},
): CEdge => ({
  key,
  from,
  to,
  ...(label !== undefined ? { label } : {}),
  direction: extra.direction ?? "forward",
  stroke: extra.stroke ?? "solid",
  routing: extra.routing ?? "straight",
});
const both = { drawio: true, mermaid: "flowchart" } as const;

export const CORPUS: CorpusEntry[] = [
  {
    id: "01-linear",
    title: "Simple linear architecture",
    categories: ["linear"],
    nodes: [
      n("client", "Client", 40, 40),
      n("gw", "API Gateway", 220, 40),
      n("svc", "Order Service", 400, 40),
      n("db", "PostgreSQL", 580, 40),
    ],
    groups: [],
    edges: [
      e("e1", "client", "gw", "HTTPS"),
      e("e2", "gw", "svc", "REST"),
      e("e3", "svc", "db", "SQL"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "02-branching",
    title: "Branching architecture",
    categories: ["branching"],
    nodes: [
      n("gw", "Gateway", 40, 140),
      n("orders", "Orders", 260, 40),
      n("users", "Users", 260, 140),
      n("billing", "Billing", 260, 240),
      n("db", "Shared DB", 480, 140),
    ],
    groups: [],
    edges: [
      e("e1", "gw", "orders"),
      e("e2", "gw", "users"),
      e("e3", "gw", "billing"),
      e("e4", "orders", "db"),
      e("e5", "billing", "db"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "03-parallel-consumers",
    title: "Parallel consumers",
    categories: ["parallel", "branching"],
    nodes: [
      n("order", "Order Service", 40, 140),
      n("kafka", "Kafka", 220, 140, 100, 60),
      n("c1", "Consumer 1", 420, 60),
      n("c2", "Consumer 2", 420, 220),
      n("pg", "PostgreSQL", 620, 140),
    ],
    groups: [],
    edges: [
      e("e1", "order", "kafka", "produce"),
      e("e2", "kafka", "c1", "consume"),
      e("e3", "kafka", "c2", "consume"),
      e("e4", "c1", "pg", "write"),
      e("e5", "c2", "pg", "write"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "04-multiple-connectors",
    title: "Multiple connectors between the same components",
    categories: ["multiple-connectors"],
    nodes: [n("web", "Web App", 40, 100), n("api", "API", 300, 100), n("cache", "Cache", 560, 100)],
    groups: [],
    edges: [
      e("e1", "web", "api", "REST"),
      e("e2", "web", "api", "gRPC", { stroke: "dashed" }),
      e("e3", "api", "web", "callback", { stroke: "dashed" }),
      e("e4", "api", "cache", "get"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "05-bidirectional",
    title: "Bidirectional request/response",
    categories: ["bidirectional", "request-response"],
    nodes: [
      n("client", "Client", 40, 100),
      n("server", "Server", 300, 100),
      n("db", "Database", 560, 100),
    ],
    groups: [],
    edges: [
      e("e1", "client", "server", "websocket", { direction: "both" }),
      e("e2", "server", "db", "query"),
      e("e3", "db", "server", "rows", { stroke: "dashed" }),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "06-nested-groups",
    title: "Nested and grouped components",
    categories: ["nested-groups"],
    nodes: [
      n("internet", "Internet", 20, 400, 120, 50),
      n("lb", "Load Balancer", 100, 120, 120, 50, "vpc"),
      n("app1", "App 1", 280, 150, 100, 50, "priv"),
      n("app2", "App 2", 280, 230, 100, 50, "priv"),
      n("db", "Database", 460, 190, 100, 50, "priv"),
    ],
    groups: [
      { key: "vpc", label: "VPC", x: 60, y: 60, w: 560, h: 300 },
      { key: "priv", label: "Private subnet", x: 250, y: 110, w: 340, h: 220, parent: "vpc" },
    ],
    edges: [
      e("e1", "internet", "lb", "443"),
      e("e2", "lb", "app1"),
      e("e3", "lb", "app2"),
      e("e4", "app1", "db"),
      e("e5", "app2", "db"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "07-labeled-connectors",
    title: "Labeled connectors with special characters",
    categories: ["labeled-connectors"],
    nodes: [
      n("a", "Cart & Checkout", 40, 60),
      n("b", "Pricing", 300, 60),
      n("c", "Café Service", 40, 220),
      n("d", "Ledger", 300, 220),
    ],
    groups: [],
    edges: [
      e("e1", "a", "b", "GET /prices/{sku}"),
      e("e2", "a", "c", "ok (200)"),
      e("e3", "c", "d", "débit → crédit"),
      e("e4", "b", "d", "a & b: 50%"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "08-dashed-curved",
    title: "Dashed, dotted-style and curved connectors",
    categories: ["dashed", "curved"],
    nodes: [
      n("a", "Source", 40, 60),
      n("b", "Worker", 300, 60),
      n("c", "Queue", 300, 220),
      n("d", "Sink", 40, 220),
    ],
    groups: [],
    edges: [
      e("e1", "a", "b", "sync"),
      e("e2", "b", "c", "async", { stroke: "dashed", routing: "curved" }),
      e("e3", "c", "d", "drain", { stroke: "dashed", routing: "orthogonal" }),
      e("e4", "a", "d", "audit", { routing: "curved" }),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "09-ambiguous-direction",
    title: "Missing or ambiguous arrow directions",
    categories: ["ambiguous-direction"],
    nodes: [
      n("a", "Alpha", 40, 100),
      n("b", "Beta", 260, 100),
      n("c", "Gamma", 480, 100),
      n("d", "Delta", 260, 240),
    ],
    groups: [],
    edges: [
      e("e1", "a", "b", "plain line", { direction: "none" }),
      e("e2", "b", "c", "arrow at source", { direction: "backward" }),
      e("e3", "b", "d", "normal"),
    ],
    danglingEdges: 1,
    formats: both,
    mermaidExclude: ["e2"],
  },
  {
    id: "10-order-flow",
    title: "Order-flow benchmark architecture",
    categories: ["linear", "branching", "parallel", "labeled-connectors"],
    nodes: [
      n("user", "User", 20, 170, 110, 60),
      n("gw", "API Gateway", 180, 170, 130, 60),
      n("auth", "Authentication Service", 180, 40, 160, 60),
      n("order", "Order Service", 380, 170, 130, 60),
      n("kafka", "Kafka", 560, 170, 110, 60),
      n("c1", "Consumer 1", 720, 100, 120, 60),
      n("c2", "Consumer 2", 720, 250, 120, 60),
      n("pg", "PostgreSQL", 900, 170, 120, 60),
    ],
    groups: [],
    edges: [
      e("e1", "user", "gw", "HTTPS"),
      e("e2", "gw", "auth", "validate"),
      e("e3", "gw", "order", "REST"),
      e("e4", "order", "kafka", "produce"),
      e("e5", "kafka", "c1", "consume"),
      e("e6", "kafka", "c2", "consume"),
      e("e7", "c1", "pg", "write"),
      e("e8", "c2", "pg", "write"),
    ],
    danglingEdges: 0,
    formats: both,
  },
  {
    id: "11-sequence",
    title: "Sequence diagram (request/response)",
    categories: ["request-response", "sequence"],
    nodes: [n("u", "User", 0, 0), n("g", "Gateway", 0, 0), n("o", "Orders", 0, 0)],
    groups: [],
    edges: [
      e("m1", "u", "g", "POST /orders"),
      e("m2", "g", "o", "create"),
      e("m3", "o", "g", "201", { stroke: "dashed" }),
      e("m4", "g", "u", "201 Created", { stroke: "dashed" }),
    ],
    danglingEdges: 0,
    formats: { drawio: false, mermaid: "sequence" },
  },
  {
    id: "12-linear-compressed",
    title: "Linear architecture saved as a compressed draw.io page",
    categories: ["linear", "compressed"],
    nodes: [n("a", "Client", 40, 40), n("b", "Gateway", 220, 40), n("c", "Service", 400, 40)],
    groups: [],
    edges: [e("e1", "a", "b", "HTTPS"), e("e2", "b", "c", "gRPC")],
    danglingEdges: 0,
    formats: { drawio: true, mermaid: false, drawioCompressed: true },
  },
  {
    id: "13-drawio-realworld",
    title:
      "draw.io export patterns: wrappers, HTML labels, layers, selection groups, edge-label cells",
    categories: [
      "real-world-drawio",
      "nested-groups",
      "labeled-connectors",
      "dashed",
      "ambiguous-direction",
    ],
    nodes: [
      n("web", "Web Client", 40, 80),
      n("api", "API", 250, 80),
      n("db", "Orders DB", 460, 70, 80, 80),
      n("worker", "Worker", 440, 290, 120, 60, "vpc"),
    ],
    groups: [{ key: "vpc", label: "Cloud VPC", x: 420, y: 240, w: 240, h: 140 }],
    edges: [
      e("e1", "web", "api", "HTTPS"),
      e("e2", "api", "db", "SQL", { routing: "orthogonal" }),
      e("e3", "api", "worker", "jobs", { stroke: "dashed" }),
      e("e5", "worker", "db", "replicate", { direction: "none" }),
    ],
    danglingEdges: 0,
    formats: { drawio: true, mermaid: false },
    raw: {
      drawio:
        '<mxfile host="Electron" agent="handwritten-corpus" version="24.7.17" type="device">\n  <diagram id="arch-page" name="Architecture">\n    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n        <mxCell id="layer-data" value="Data layer" parent="0" />\n        <UserObject label="&lt;b&gt;Web&lt;/b&gt;&lt;br&gt;Client" tooltip="browser app" id="web 1">\n          <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">\n            <mxGeometry x="40" y="80" width="120" height="60" as="geometry" />\n          </mxCell>\n        </UserObject>\n        <mxCell id="grpA" value="" style="group" vertex="1" connectable="0" parent="1">\n          <mxGeometry x="240" y="40" width="140" height="160" as="geometry" />\n        </mxCell>\n        <mxCell id="api" value="API" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="grpA">\n          <mxGeometry x="10" y="40" width="120" height="60" as="geometry" />\n        </mxCell>\n        <mxCell id="note1" value="handles auth &amp;amp; rate limits" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;" vertex="1" parent="1">\n          <mxGeometry x="240" y="220" width="140" height="30" as="geometry" />\n        </mxCell>\n        <mxCell id="db" value="Orders DB" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;" vertex="1" parent="layer-data">\n          <mxGeometry x="460" y="70" width="80" height="80" as="geometry" />\n        </mxCell>\n        <mxCell id="vpc" value="Cloud VPC" style="points=[];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;container=1;collapsible=0;html=1;" vertex="1" parent="1">\n          <mxGeometry x="420" y="240" width="240" height="140" as="geometry" />\n        </mxCell>\n        <mxCell id="w-1" value="Worker" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="vpc">\n          <mxGeometry x="20" y="50" width="120" height="60" as="geometry" />\n        </mxCell>\n        <mxCell id="e1" style="edgeStyle=none;rounded=0;html=1;" edge="1" parent="1" source="web 1" target="api">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>\n        <mxCell id="lbl1" value="HTTPS" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="e1">\n          <mxGeometry x="-0.1" relative="1" as="geometry">\n            <mxPoint as="offset" />\n          </mxGeometry>\n        </mxCell>\n        <mxCell id="e2" value="SQL" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="api" target="db">\n          <mxGeometry relative="1" as="geometry">\n            <Array as="points">\n              <mxPoint x="420" y="110" />\n            </Array>\n          </mxGeometry>\n        </mxCell>\n        <mxCell id="e3" value="jobs" style="dashed=1;endArrow=open;endFill=0;html=1;" edge="1" parent="1" source="api" target="w-1">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>\n        <mxCell id="e4" value="deploys" style="html=1;" edge="1" parent="1" source="web 1" target="vpc">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>\n        <mxCell id="e5" value="replicate" style="endArrow=none;startArrow=none;html=1;" edge="1" parent="1" source="w-1" target="db">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n',
    },
  },
  {
    id: "14-mermaid-syntax",
    title:
      "Mermaid flowchart syntax variety (shapes, chains, fan-out, text links, subgraphs, styling)",
    categories: [
      "mermaid-syntax",
      "nested-groups",
      "labeled-connectors",
      "dashed",
      "bidirectional",
    ],
    nodes: [
      n("U", "User", 0, 0),
      n("GW", 'API "Edge" Gateway', 0, 0, 120, 60, "edge"),
      n("AUTH", "Auth Service", 0, 0),
      n("ORD", "Order Service", 0, 0, 120, 60, "core"),
      n("PAY", "Payments", 0, 0, 120, 60, "core"),
      n("DB", "Orders DB", 0, 0),
      n("Q", "Event Queue", 0, 0),
      n("MON", "Monitor", 0, 0),
    ],
    groups: [
      { key: "edge", label: "Edge tier", x: 0, y: 0, w: 0, h: 0 },
      { key: "core", label: "Core services", x: 0, y: 0, w: 0, h: 0 },
    ],
    edges: [
      e("l1", "U", "GW"),
      e("l2", "GW", "AUTH", "validate"),
      e("l3", "GW", "ORD"),
      e("l4", "ORD", "PAY"),
      e("l5", "ORD", "DB"),
      e("l6", "PAY", "DB"),
      e("l7", "ORD", "Q", "emit", { stroke: "dashed" }),
      e("l8", "Q", "MON", undefined, { direction: "both" }),
    ],
    danglingEdges: 0,
    formats: { drawio: false, mermaid: "flowchart" },
    raw: {
      mermaid:
        '---\ntitle: Checkout platform\n---\n%%{init: {"theme": "dark"}}%%\ngraph TD\n    %% clients\n    U((User)) --> GW{{"API #quot;Edge#quot; Gateway"}}\n    GW -- validate --> AUTH[Auth Service]:::svc\n    GW ==> ORD(Order Service) --> PAY[/Payments/]\n    ORD & PAY --> DB[(Orders DB)]\n    ORD -.->|emit| Q>Event Queue]\n    Q o--o MON[Monitor]\n    MON ~~~ DB\n    subgraph "Edge tier"\n      GW\n    end\n    subgraph core [Core services]\n      ORD\n      PAY\n    end\n    U --> core\n    classDef svc fill:#eef\n    class AUTH svc\n    style DB fill:#fdd;\n    click AUTH "https://example.com"\n',
    },
  },
  {
    id: "15-sequence-rich",
    title:
      "Mermaid sequence: actors, aliases, box, activations, failed and async messages, par, loop, note",
    categories: ["sequence", "request-response", "parallel", "nested-groups"],
    nodes: [
      n("C", "Customer", 0, 0),
      n("API", "Order API", 0, 0, 120, 60, "box"),
      n("PAY", "Payments", 0, 0, 120, 60, "box"),
      n("Q", "Event bus", 0, 0),
    ],
    groups: [{ key: "box", label: "Backend services", x: 0, y: 0, w: 0, h: 0 }],
    edges: [
      e("m1", "C", "API", "POST /orders"),
      e("m2", "API", "PAY", "charge"),
      e("m3", "PAY", "API", "declined"),
      e("m4", "API", "PAY", "charge (retry)"),
      e("m5", "PAY", "API", "ok", { stroke: "dashed" }),
      e("m6", "API", "Q", "OrderPlaced"),
      e("m7", "API", "C", "201 Created", { stroke: "dashed" }),
      e("m8", "C", "API", "GET /orders/1"),
    ],
    danglingEdges: 0,
    formats: { drawio: false, mermaid: "sequence" },
    raw: {
      mermaid:
        "sequenceDiagram\n    autonumber\n    title Checkout\n    actor C as Customer\n    box Backend services\n      participant API as Order API\n      participant PAY as Payments\n    end\n    participant Q as Event bus\n    C->>+API: POST /orders\n    API->>PAY: charge\n    PAY-xAPI: declined\n    API->>PAY: charge (retry)\n    PAY-->>API: ok\n    Note over API,PAY: payment settled\n    par notify\n      API-)Q: OrderPlaced\n    and respond\n      API-->>-C: 201 Created\n    end\n    loop every 5s\n      C->>API: GET /orders/1\n    end\n",
    },
  },
  {
    id: "16-plantuml-component",
    title:
      "PlantUML component diagram: aliases, element kinds, packages, directional and coloured arrows",
    categories: ["plantuml", "nested-groups", "labeled-connectors", "dashed"],
    nodes: [
      n("cust", "Customer", 0, 0),
      n("lb", "Load Balancer", 0, 0, 120, 60, "edge"),
      n("orders", "Order Service", 0, 0, 120, 60, "services"),
      n("pay", "Payment Service", 0, 0, 120, 60, "services"),
      n("db", "Orders DB", 0, 0),
      n("events", "Events", 0, 0),
      n("stripe", "Stripe", 0, 0),
    ],
    groups: [
      { key: "edge", label: "Edge", x: 0, y: 0, w: 0, h: 0 },
      { key: "services", label: "Services", x: 0, y: 0, w: 0, h: 0 },
    ],
    edges: [
      e("p1", "cust", "lb", "HTTPS"),
      e("p2", "lb", "orders"),
      e("p3", "orders", "events", "OrderPlaced", { stroke: "dashed" }),
      e("p4", "orders", "db", "SQL"),
      e("p5", "orders", "pay", "charge"),
      e("p6", "pay", "stripe"),
      e("p7", "pay", "events", "consume", { stroke: "dashed" }),
    ],
    danglingEdges: 0,
    formats: { drawio: false, mermaid: false, plantuml: "component" },
    raw: {
      plantuml:
        '@startuml\ntitle Shop platform\nleft to right direction\nskinparam componentStyle rectangle\nactor Customer as cust\nnode "Edge" {\n  [Load Balancer] as lb\n}\npackage "Services" {\n  component [Order Service] as orders\n  component "Payment Service" as pay\n}\ndatabase "Orders DB" as db\nqueue "Events" as events\ncloud "Stripe" as stripe\ncust --> lb : HTTPS\nlb -right-> orders\norders ..> events : OrderPlaced\norders --> db : SQL\norders -[#red]-> pay : charge\npay --> stripe\nevents <.. pay : consume\n\' a comment\nnote right of db : primary\n@enduml\n',
    },
  },
  {
    id: "17-plantuml-sequence",
    title: "PlantUML sequence diagram: actor, aliases, box, activation, failed message, alt",
    categories: ["plantuml", "sequence", "request-response"],
    nodes: [
      n("U", "User", 0, 0),
      n("W", "Web App", 0, 0),
      n("API", "Orders API", 0, 0, 120, 60, "backend"),
      n("DB", "Orders DB", 0, 0, 120, 60, "backend"),
    ],
    groups: [{ key: "backend", label: "Backend", x: 0, y: 0, w: 0, h: 0 }],
    edges: [
      e("s1", "U", "W", "open checkout"),
      e("s2", "W", "API", "POST /orders"),
      e("s3", "API", "DB", "INSERT"),
      e("s4", "DB", "API", "ok", { stroke: "dashed" }),
      e("s5", "API", "DB", "audit"),
      e("s6", "API", "W", "201", { stroke: "dashed" }),
      e("s7", "API", "W", "500", { stroke: "dashed" }),
      e("s8", "W", "U", "confirmation", { stroke: "dashed" }),
    ],
    danglingEdges: 0,
    formats: { drawio: false, mermaid: false, plantuml: "sequence" },
    raw: {
      plantuml:
        '@startuml\ntitle Checkout\nactor User as U\nparticipant "Web App" as W\nbox "Backend"\n  participant "Orders API" as API\n  database "Orders DB" as DB\nend box\nU -> W : open checkout\nW -> API : POST /orders\nactivate API\nAPI -> DB : INSERT\nDB --> API : ok\nAPI ->x DB : audit\nalt success\n  API --> W : 201\nelse failure\n  API --> W : 500\nend\nW --> U : confirmation\ndeactivate API\n@enduml\n',
    },
  },
];

// ---------- renderers ----------

const xmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const arrows = (d: Direction): string => {
  switch (d) {
    case "forward":
      return "startArrow=none;endArrow=classic;";
    case "backward":
      return "startArrow=classic;endArrow=none;";
    case "both":
      return "startArrow=classic;endArrow=classic;";
    case "none":
      return "startArrow=none;endArrow=none;";
  }
};

function drawioModel(entry: CorpusEntry): string {
  const groupByKey = new Map(entry.groups.map((g) => [g.key, g]));
  /** Absolute origin of a group's content area = absolute position of the group itself. */
  const absGroup = (g: CGroup): { x: number; y: number } => ({ x: g.x, y: g.y });
  const rel = (parent: CGroup | undefined, x: number, y: number): { x: number; y: number } =>
    parent ? { x: x - absGroup(parent).x, y: y - absGroup(parent).y } : { x, y };
  const cells: string[] = [];
  for (const g of entry.groups) {
    const parent = g.parent ? groupByKey.get(g.parent) : undefined;
    const p = rel(parent, g.x, g.y);
    cells.push(
      `<mxCell id="${g.key}" value="${xmlEsc(g.label)}" style="swimlane;whiteSpace=wrap;html=1;startSize=24;dashed=1;fillColor=none;" vertex="1" parent="${parent ? parent.key : "1"}"><mxGeometry x="${p.x}" y="${p.y}" width="${g.w}" height="${g.h}" as="geometry"/></mxCell>`,
    );
  }
  for (const nd of entry.nodes) {
    const parent = nd.group ? groupByKey.get(nd.group) : undefined;
    const p = rel(parent, nd.x, nd.y);
    cells.push(
      `<mxCell id="${nd.key}" value="${xmlEsc(nd.label)}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="${parent ? parent.key : "1"}"><mxGeometry x="${p.x}" y="${p.y}" width="${nd.w}" height="${nd.h}" as="geometry"/></mxCell>`,
    );
  }
  for (const ed of entry.edges) {
    const routing =
      ed.routing === "orthogonal"
        ? "edgeStyle=orthogonalEdgeStyle;"
        : ed.routing === "curved"
          ? "curved=1;"
          : "";
    const style = `${routing}rounded=0;html=1;${arrows(ed.direction)}${ed.stroke === "dashed" ? "dashed=1;" : ""}`;
    cells.push(
      `<mxCell id="${ed.key}" value="${xmlEsc(ed.label ?? "")}" style="${style}" edge="1" parent="1" source="${ed.from}" target="${ed.to}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }
  for (let i = 0; i < entry.danglingEdges; i++) {
    const src = entry.nodes[0]!;
    cells.push(
      `<mxCell id="dangling${i + 1}" value="dangling" style="html=1;endArrow=classic;" edge="1" parent="1" source="${src.key}"><mxGeometry relative="1" as="geometry"><mxPoint x="${src.x + 300}" y="${src.y + 400}" as="targetPoint"/></mxGeometry></mxCell>`,
    );
  }
  return `<mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel>`;
}

export function renderDrawio(entry: CorpusEntry): string {
  const model = drawioModel(entry);
  const body = entry.formats.drawioCompressed
    ? deflateRawSync(Buffer.from(encodeURIComponent(model), "utf8")).toString("base64")
    : model;
  return `<mxfile host="app.diagrams.net" version="24.0.0"><diagram id="${entry.id}" name="Page-1">${body}</diagram></mxfile>\n`;
}

const mq = (s: string): string => `"${s.replace(/"/g, "#quot;")}"`;

export function mermaidEdges(entry: CorpusEntry): CEdge[] {
  return entry.edges.filter((ed) => !(entry.mermaidExclude ?? []).includes(ed.key));
}

export function renderMermaid(entry: CorpusEntry): string {
  if (entry.formats.mermaid === "sequence") {
    const lines = ["sequenceDiagram"];
    for (const nd of entry.nodes) lines.push(`    participant ${nd.key} as ${nd.label}`);
    for (const ed of entry.edges)
      lines.push(
        `    ${ed.from}${ed.stroke === "dashed" ? "-->>" : "->>"}${ed.to}: ${ed.label ?? ""}`,
      );
    return lines.join("\n") + "\n";
  }
  const lines = ["flowchart LR"];
  const children = (parent: string | undefined): CGroup[] =>
    entry.groups.filter((g) => g.parent === parent);
  const emitGroup = (g: CGroup, indent: string): void => {
    lines.push(`${indent}subgraph ${g.key}[${mq(g.label)}]`);
    for (const nd of entry.nodes.filter((x) => x.group === g.key))
      lines.push(`${indent}    ${nd.key}[${mq(nd.label)}]`);
    for (const c of children(g.key)) emitGroup(c, indent + "    ");
    lines.push(`${indent}end`);
  };
  for (const nd of entry.nodes.filter((x) => !x.group))
    lines.push(`    ${nd.key}[${mq(nd.label)}]`);
  for (const g of children(undefined)) emitGroup(g, "    ");
  for (const ed of mermaidEdges(entry)) {
    const dashed = ed.stroke === "dashed";
    const op =
      ed.direction === "both"
        ? dashed
          ? "<-.->"
          : "<-->"
        : ed.direction === "none"
          ? dashed
            ? "-.-"
            : "---"
          : dashed
            ? "-.->"
            : "-->";
    lines.push(`    ${ed.from} ${op}${ed.label !== undefined ? `|${mq(ed.label)}|` : ""} ${ed.to}`);
  }
  return lines.join("\n") + "\n";
}

/** What a format can express: used to separate "importer failed" from "cannot be expressed". */
export type Format =
  "drawio" | "mermaid-flowchart" | "mermaid-sequence" | "plantuml-component" | "plantuml-sequence";

export function truthFor(entry: CorpusEntry, format: Format): CorpusEntry {
  if (format === "drawio") return entry;
  // PlantUML can express every edge direction (`a <-- b` is an arrow at a); no geometry.
  if (format.startsWith("plantuml")) return { ...entry, danglingEdges: 0 };
  const edges = mermaidEdges(entry);
  return { ...entry, edges, danglingEdges: 0 };
}

export function corpusFiles(entry: CorpusEntry): Record<string, string> {
  const out: Record<string, string> = {
    [`${entry.id}.truth.json`]: JSON.stringify(entry, null, 2) + "\n",
  };
  if (entry.formats.drawio) out[`${entry.id}.drawio`] = entry.raw?.drawio ?? renderDrawio(entry);
  if (entry.formats.mermaid) out[`${entry.id}.mmd`] = entry.raw?.mermaid ?? renderMermaid(entry);
  if (plantumlKind(entry)) out[`${entry.id}.puml`] = entry.raw?.plantuml ?? renderPlantUml(entry);
  return out;
}

/** PlantUML variant for an entry: explicit, or derived for generated (non-raw) Mermaid entries. */
export function plantumlKind(entry: CorpusEntry): "component" | "sequence" | undefined {
  if (entry.formats.plantuml) return entry.formats.plantuml;
  if (entry.raw) return undefined;
  if (entry.formats.mermaid === "sequence") return "sequence";
  if (entry.formats.mermaid === "flowchart") return "component";
  return undefined;
}

const pq = (s: string): string => `"${s.replace(/"/g, "'")}"`;

export function renderPlantUml(entry: CorpusEntry): string {
  const lines = ["@startuml", `title ${entry.title}`];
  if (plantumlKind(entry) === "sequence") {
    for (const nd of entry.nodes) lines.push(`participant ${pq(nd.label)} as ${nd.key}`);
    for (const ed of entry.edges)
      lines.push(
        `${ed.from} ${ed.stroke === "dashed" ? "-->" : "->"} ${ed.to} : ${ed.label ?? ""}`,
      );
    return lines.concat("@enduml").join("\n") + "\n";
  }
  lines.push("left to right direction");
  const emit = (parent: string | undefined, indent: string): void => {
    for (const nd of entry.nodes.filter((x) => x.group === parent))
      lines.push(`${indent}component ${pq(nd.label)} as ${nd.key}`);
    for (const g of entry.groups.filter((x) => x.parent === parent)) {
      lines.push(`${indent}package ${pq(g.label)} as ${g.key} {`);
      emit(g.key, indent + "  ");
      lines.push(`${indent}}`);
    }
  };
  emit(undefined, "");
  for (const ed of entry.edges) {
    const l = ed.stroke === "dashed" ? "." : "-";
    const op =
      ed.direction === "both"
        ? `<${l}${l}>`
        : ed.direction === "none"
          ? `${l}${l}`
          : ed.direction === "backward"
            ? `<${l}${l}`
            : `${l}${l}>`;
    lines.push(`${ed.from} ${op} ${ed.to}${ed.label !== undefined ? ` : ${ed.label}` : ""}`);
  }
  return lines.concat("@enduml").join("\n") + "\n";
}
