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
  /** One line for the example gallery: what the animation shows. */
  blurb: string;
}

export const SAMPLES: Sample[] = [
  {
    id: "bench-text",
    title: "Order flow — text description",
    kind: "text",
    text: benchText,
    blurb: "API gateway, Kafka events, two consumers and a database timeout with a retry.",
  },
  {
    id: "bench-sentences",
    title: "Order flow — plain English",
    kind: "text",
    text: benchSentences,
    blurb: "The same order flow written as ordinary sentences.",
  },
  {
    id: "bench-mermaid",
    title: "Order flow — Mermaid flowchart (+ injected timeout)",
    kind: "mermaid",
    text: benchMermaid,
    options: { failure: { from: "Consumer 1", to: "PostgreSQL", mode: "timeout", retries: 1 } },
    blurb: "A Mermaid flowchart with a failure injected from the Scenario tab.",
  },
  {
    id: "aws-alb",
    title: "AWS load balancer + health checks — text",
    kind: "text",
    text: awsAlb,
    blurb:
      "ALB listener rules pick one target group; health checks find an unhealthy target and route around it.",
  },
  {
    id: "sequence",
    title: "Checkout — Mermaid sequence diagram",
    kind: "mermaid",
    text: sequence,
    blurb: "Requests, responses and parallel calls taken from a sequence diagram.",
  },
  {
    id: "mermaid-syntax",
    title: "Checkout platform — Mermaid with subgraphs",
    kind: "mermaid",
    text: mermaidSyntax,
    blurb: "Subgraphs, node shapes and labelled connectors in Mermaid.",
  },
  {
    id: "drawio-order",
    title: "Microservices — draw.io",
    kind: "drawio",
    text: drawioOrder,
    blurb: "A draw.io microservices diagram animated with its original geometry.",
  },
  {
    id: "drawio-real",
    title: "Web app + VPC — draw.io export",
    kind: "drawio",
    text: drawioReal,
    blurb: "A real-world draw.io export with containers and nested groups.",
  },
  {
    id: "puml-component",
    title: "Shop platform — PlantUML component diagram",
    kind: "plantuml",
    text: pumlComponent,
    blurb: "Components, interfaces and connectors from PlantUML.",
  },
  {
    id: "puml-sequence",
    title: "Checkout — PlantUML sequence diagram",
    kind: "plantuml",
    text: pumlSequence,
    blurb: "A PlantUML sequence diagram played as request and response traffic.",
  },
  {
    id: "canonical",
    title: "Hand-authored scenario — ArchFlow JSON",
    kind: "json",
    text: JSON.stringify(canonical, null, 2),
    blurb: "A canonical ArchFlow document with a hand-written scenario.",
  },
];
