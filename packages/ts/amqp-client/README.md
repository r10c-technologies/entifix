# @entifix/amqp

RabbitMQ, on `amqplib`. The root entry provides the connection, the channel and a health probe. The `transactions` subpath implements the `EventBus` port from `@entifix/transactions`: publishing onto a topic exchange, consuming with retry, and quarantining a message that cannot be processed rather than redelivering it forever.

Bus throughput and failures are recorded as metrics.

## Install

```sh
pnpm add @entifix/amqp effect
```

## Entry points

| Import                       | What it holds                                                              |
| ---------------------------- | -------------------------------------------------------------------------- |
| `@entifix/amqp`              | `makeAmqpConnector`, `AmqpLayer`, `AmqpChannelTag`, `AmqpHealthProbeLayer` |
| `@entifix/amqp/transactions` | `makeAmqpEventBus`, `AmqpEventBusLayer`, bus metrics                       |

## Optional peers

Install these only if you use what needs them.

| Peer                    | Needed by                    |
| ----------------------- | ---------------------------- |
| `@entifix/transactions` | `@entifix/amqp/transactions` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
