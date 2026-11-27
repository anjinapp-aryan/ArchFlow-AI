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
| End | The entry component turns `success` when its response arrives |
| Timing | 800 ms per packet, 200 ms gaps, 1.5 s timeouts (all configurable) |
| Safety | Each path is cycle-free. Traffic is capped at 1,500 packets or 8 minutes (`synth.truncated`). The output always passes the canonical validator, otherwise the run fails |

Warnings: `synth.unreached` (a component gets no traffic), `synth.no_traffic`, `synth.failure_not_reached`, `synth.truncated`. Errors: `synth.unknown_node`, `synth.empty`, `synth.too_long`, `synth.invalid_output.*`.

## 2. Text descriptions (`parseDescription`, `textToAnimation`)

```
title: Order flow benchmark
User -> API Gateway : POST /orders           chains; ": label" labels every hop on the line
API Gateway -> Authentication Service : validate
Order Service ..> Kafka : OrderCreated        ..> = asynchronous (dashed)
Kafka ..> Consumer 1, Consumer 2 : consume    ","  = fan-out / fan-in
A <-> B    A -- B    A <- B                   both ways / no arrow / reversed
entry: User
fail: Consumer 1 -> PostgreSQL timeout retries 1
```

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
