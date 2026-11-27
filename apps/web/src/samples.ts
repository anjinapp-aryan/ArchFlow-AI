import benchText from "../../../fixtures/benchmark/order-flow.txt";
import benchSentences from "../../../fixtures/benchmark/order-flow.sentences.txt";
import benchMermaid from "../../../fixtures/benchmark/order-flow.mmd";
import sequence from "../../../fixtures/diagrams/15-sequence-rich.mmd";
import drawioReal from "../../../fixtures/diagrams/13-drawio-realworld.drawio";
import drawioOrder from "../../../fixtures/diagrams/10-order-flow.drawio";
import mermaidSyntax from "../../../fixtures/diagrams/14-mermaid-syntax.mmd";
import pumlComponent from "../../../fixtures/diagrams/16-plantuml-component.puml";
import pumlSequence from "../../../fixtures/diagrams/17-plantuml-sequence.puml";
import awsAlb from "../../../fixtures/regression/aws-alb.txt";
import canonical from "../../../fixtures/scenarios/order-flow.canonical.json";
import type { SourceKind, UserScenarioOptions } from "./pipeline.ts";

export interface Sample {
  id: string;
  title: string;
  kind: SourceKind;
  text: string;
  options?: UserScenarioOptions;
}

export const SAMPLES: Sample[] = [
  { id: "bench-text", title: "Order flow — text description", kind: "text", text: benchText },
  {
    id: "bench-sentences",
    title: "Order flow — plain English",
    kind: "text",
    text: benchSentences,
  },
  {
    id: "bench-mermaid",
    title: "Order flow — Mermaid flowchart (+ injected timeout)",
    kind: "mermaid",
    text: benchMermaid,
    options: { failure: { from: "Consumer 1", to: "PostgreSQL", mode: "timeout", retries: 1 } },
  },
  {
    id: "aws-alb",
    title: "AWS load balancer + health checks — text",
    kind: "text",
    text: awsAlb,
  },
  { id: "sequence", title: "Checkout — Mermaid sequence diagram", kind: "mermaid", text: sequence },
  {
    id: "mermaid-syntax",
    title: "Checkout platform — Mermaid with subgraphs",
    kind: "mermaid",
    text: mermaidSyntax,
  },
  { id: "drawio-order", title: "Microservices — draw.io", kind: "drawio", text: drawioOrder },
  { id: "drawio-real", title: "Web app + VPC — draw.io export", kind: "drawio", text: drawioReal },
  {
    id: "puml-component",
    title: "Shop platform — PlantUML component diagram",
    kind: "plantuml",
    text: pumlComponent,
  },
  {
    id: "puml-sequence",
    title: "Checkout — PlantUML sequence diagram",
    kind: "plantuml",
    text: pumlSequence,
  },
  {
    id: "canonical",
    title: "Hand-authored scenario — ArchFlow JSON",
    kind: "json",
    text: JSON.stringify(canonical, null, 2),
  },
];
