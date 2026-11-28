# Scenario synthesizer and text descriptions (`@archflow/scenario-synthesizer`)

The synthesizer turns any canonical diagram into an animation scenario, using deterministic rules with no LLM, no randomness and no clock. It also accepts a text description: arrow lines or simple English sentences.

## 1. Traffic rules (`synthesizeScenario`)

| Rule | Behaviour |
| --- | --- |
| Entry | Option `entry`; else the first `user`/`client` component with outgoing traffic; else the first component with no inbound arrow |
| Direction | Follows connector arrows. `none` and `both` connectors may be used either way. A backward connector carries traffic from `to` to `from` |
| Synchronous call | `request` packet, the callee does its own downstream work, then a `response` back on the same connector (`respondsTo`). Callee shown `active` while busy |
| Asynchronous call | Into or out of a queue-like component (kind `queue`, or a label such as Kafka/RabbitMQ/SQS/topic/event bus), or along a dashed connector: an `event` packet, with nobody waiting |
| Parallelism | Several async consumers start at the same instant, each in its own flow (`parentFlowId` = publisher's flow) |
| Ordering | Sync calls run one after another in document order. The publisher continues once its message has left |
| Failures | Option `failures: [{ from, to, mode: "timeout" \| "error", retries }]`. Attempts fail (timeout badge or red error packet), retries follow (`retry`, `retryOf`, `attempt` n+1), and the last one succeeds. The caller shows `warn` while retrying, then `active` with `recovers` |
| Health checks | Connectors with `interaction: monitoring` are never request hops, and a monitor-only component is never the entry. Each such connector gets periodic `probe` packets in separate flows ("Health check round n"): 2–4 rounds spread over the animation, independent of request timing. A healthy target answers `success` ("healthy") on the same connector and flashes `success`. A failure injected on a health check (`fail: Checker -> Target timeout`) makes probes time out (a timer on the checker) or error; from the first failed probe the target stays `down` ("unhealthy") until the end (or until traffic uses it again, fail-open), instead of flashing. Status flashes use the target's next free moment, because the model forbids two states at once. Interval text such as "every 30s" stays a label; animation time is not real time and no AWS thresholds are invented. Retries do not apply to probes (`synth.probe_retries_ignored`) |
| Unhealthy targets | A target is *known* unhealthy once its first failed probe concludes (the timeout expired, or the error answer arrived). From then on, a caller with several synchronous callees, such as a target group doing round-robin, skips that target while at least one healthy callee remains. A note says so ("Order API skipped: unhealthy"). With no healthy alternative left, traffic is still sent, so it never silently disappears |
| Packet labels | A generated packet carries a label only when its connector has none ("request", "event"), plus status words such as retry, ok, healthy and unhealthy. The engine draws a packet's label just above the moving packet, so repeating the connector's label would only cover it |
| Notes | A note is placed where it covers no component, no connector label and no note shown at the same time, and stays within 60 px of the diagram so the engine's frame shows it (`notes.ts`) |
| Ending | After all traffic, a summary note on the whole diagram states the outcome in words: "✓ Success: <entry> received its response", recovered failures ("B → C: timeout, recovered after 2 retries"), unhealthy targets; "✗ Failed: …" when the entry got no answer; "✓ Done: every message was delivered" for message-only flows. The entry's final state and unhealthy targets are held to the end, and the animation ends with the summary |
| Routing | A routing component sends each request to ONE callee, not to every callee in turn. **Rule routers**: the connector labels state conditions, either path patterns (`/api/*`, `/auth*`), host patterns (`host auth.app`) or a default rule (`default`, `fallback`, `catch-all`, `otherwise`). The first connector in document order (the rule priority) whose condition matches the request (`request:`) wins, otherwise the default rule. Path patterns are case-sensitive and host patterns are not, as in ALB listener rules. Without a `request:`, the default rule is used and reported (`synth.route_default`). When nothing matches and there is no default rule, the request stops at the router (`synth.no_rule_matched`). **Balancers**: load balancers, target groups, or connectors labelled "round-robin", "weighted", "least connections" or "healthy targets". They pick the next target in turn that is healthy, and skipped unhealthy targets get a note. When no target is healthy, they fail open. A note shows the request and the matched rule. Components the request is routed past are reported once (`info.routes_not_taken`), not as unreached. Every decision is returned in `routing` |
| Explicit responses | When a `response` connector is drawn from the callee back to the caller, responses travel on it |
| End | The entry component turns `success` when its response arrives |
| Timing | 800 ms per packet, 200 ms gaps, 1.5 s timeouts (all configurable) |
| Safety | Each path is cycle-free. Traffic is capped at 1,500 packets or 8 minutes (`synth.truncated`). The output always passes the canonical validator, otherwise the run fails |

Warnings: `synth.unreached` (a component gets no traffic), `synth.no_traffic`, `synth.failure_not_reached`, `synth.truncated`. Errors: `synth.unknown_node`, `synth.empty`, `synth.too_long`, `synth.invalid_output.*`.

## 2. Text descriptions (`parseDescription`, `textToAnimation`)

```
title: Order flow benchmark
User -> API Gateway : POST /orders           chains; ": label" labels every hop on the line
API Gateway -> Authentication Service : validate
Order Service ..> Kafka : OrderCreated        ..> = asynchronous (dotted, animated while in use)
Kafka ..> Consumer 1, Consumer 2 : consume    ","  = fan-out / fan-in
A <-> B    A -- B    A <- B                   both ways / no arrow / reversed
entry: User
request: GET /api/orders                      what the entry sends; rule routers match its path and host
fail: Consumer 1 -> PostgreSQL timeout retries 1
monitor: ALB Health Check -> Order API, Payment API : GET /health every 30s
```

`monitor:` (also `health:` or `probe:`) marks health checks. Without it, a connector is still treated as monitoring when its label reads like a health check (health check, /health, liveness, readiness, heartbeat, probe, ping) or its source is a monitoring component (health checker, monitor, watchdog, uptime). That inference is always reported (`text.monitoring_inferred`; `mermaid.monitoring_inferred` in Mermaid flowcharts). Every connector gets an explicit `interaction`.

Sentences work too, one per line or several per paragraph:

- "The User sends POST /orders to the API Gateway."
- "The Order Service publishes OrderCreated to Kafka."
- "Consumer 1 consumes from Kafka." (consume and subscribe mean a reversed, asynchronous link)
- "The Web App calls the Orders API."
- "Consumer 1 times out writing to PostgreSQL and retries once."

Component kinds are inferred from names: user, client, gateway, load balancer, queue, cache, db, cloud storage, external (for example Stripe). Anything not understood is reported (`text.unrecognised`), never guessed.

## 3. Benchmark (master prompt P1.5)

Inputs:
- `fixtures/benchmark/order-flow.txt` (arrows);
- `order-flow.sentences.txt` (plain English);
- `order-flow.mmd` (Mermaid, with the failure passed as an option).

`packages/scenario-synthesizer/test/benchmark.test.ts` checks all nine required beats on each input:

1. user request;
2. gateway forwards it;
3. auth validates and answers first;
4. order service processes it;
5. publish to Kafka;
6. two consumers start at the same instant in separate flows;
7. a database write;
8. a timeout followed by retry attempt 2 (`retryOf`) with a warning and recovery;
9. responses order → gateway → user, then success.

The browser test renders the same scenarios in the WASM engine and checks the right labels at the right instants (two `consume` packets at once, `timeout`, `retry`, final `ok`), with reproducible frames.

## 4. Limits

- One request path per entry. Loops and branches in the logic (if/else) are not modelled.
- Failures are configured, not inferred.
- Timing is uniform, not measured from real systems.
- Very dense graphs are truncated, with a warning.
