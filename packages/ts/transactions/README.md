# @entifix/transactions

Writes that span more than one step. The event announcing a write is enqueued in an outbox inside the same unit of work as the write itself, ordered per aggregate; a redelivered message is claimed once through the inbox; and a flow across several services is a composed slip run by a durable engine behind the `FlowEngineTag` port, whose participants are guarded by a circuit breaker, a bulkhead and a retry budget.

This package holds the ports and the in-memory resilience engines only. The storage and transport behind them come from `@entifix/mongo/transactions`, `@entifix/sql/transactions`, `@entifix/amqp/transactions` and `@entifix/workflow`.

## Install

```sh
pnpm add @entifix/transactions effect
```

## Entry points

| Import                         | What it holds                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/transactions`        | The unit of work; inbox, outbox and event-bus ports; the flow engine, participant client, circuit breaker, bulkhead and retry budget ports; flow messages and capabilities; `On` |
| `@entifix/transactions/engine` | The in-memory circuit breaker, bulkhead and retry budget, and the outbox relay and its metrics |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
