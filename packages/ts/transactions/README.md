# @entifix/transactions

Writes that span more than one step. A client mints the transaction id, which is also the idempotency key; the event announcing a write is enqueued in an outbox inside the same database transaction as the write itself; and a flow across several services is a saga — a declarative definition, run and resumed from its own record.

This package holds the ports and the engine only. The storage and transport behind them come from `@entifix/mongo/transactions`, `@entifix/redis/transactions` and `@entifix/amqp/transactions`.

## Install

```sh
pnpm add @entifix/transactions effect
```

## Entry points

| Import                  | What it holds                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@entifix/transactions` | Command envelopes, transaction events, inbox / outbox / event-bus / lock / sequence ports, `defineSaga`, `runSaga`, `resumeSaga`, the transaction stream hub |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
