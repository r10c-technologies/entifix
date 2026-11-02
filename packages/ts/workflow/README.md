# @entifix/workflow

Durable flows. A flow is a pinned routing slip, and this package interprets it on Effect Workflow behind the `FlowEngineTag` port from `@entifix/transactions`: each step an Activity keyed `<flowId>:<step>`, a refusal before the commit point compensated in reverse, a failure after it suspended and resumed, and a `wait` step parked on a durable deferred its signal completes.

`effect/workflow` and `effect/cluster` are imported here and nowhere else in entifix — their APIs are unstable, and the chaos suite pins what this package relies on.

## Install

```sh
pnpm add @entifix/workflow effect
# a deployment of several runners:
pnpm add @effect/platform-node
```

## Entry points

| Import                            | What it holds                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@entifix/workflow`               | `FlowEngineLayer`, `makeFlowEngine`, `SlipWorkflow`, `interpretSlip`, `FlowStatusStoreTag`, the in-memory status store |
| `@entifix/workflow/postgres`      | `SingleRunnerFlowEngineLayer` and the SQL status store, over the host's `SqlClient`                                    |
| `@entifix/workflow/socket-runner` | `SocketRunnerFlowEngineLayer`, one runner among several; needs `@effect/platform-node`                                 |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
