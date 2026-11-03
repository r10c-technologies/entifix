'use client';

import type { EntifixFailure, WriteResult } from '@entifix/core';
import { flowLink } from '@entifix/core';
import { useMutation } from '@tanstack/react-query';
import { Cause, Effect, Exit } from 'effect';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react';

import type { FlowOutcome, PendingFlowStore } from './pending-flow-store.js';

const PendingFlowStoreContext = createContext<PendingFlowStore | undefined>(
  undefined,
);

/** Makes `store` the one every optimistic mutation below records into. */
export function PendingFlowStoreProvider({
  store,
  children,
}: {
  readonly store: PendingFlowStore;
  readonly children: ReactNode;
}) {
  return (
    <PendingFlowStoreContext.Provider value={store}>
      {children}
    </PendingFlowStoreContext.Provider>
  );
}

/** The store a {@link PendingFlowStoreProvider} above provides, if any. */
export const usePendingFlowStore = (): PendingFlowStore | undefined =>
  useContext(PendingFlowStoreContext);

/**
 * Where an optimistic write stands. `settled` is a write that happened;
 * `pending`, `confirmed` and `failed` are a flow's, and nothing finer: a
 * `202` never says a payment was captured or an order placed, so neither may
 * the screen.
 */
export type OptimisticStatus =
  'idle' | 'running' | 'settled' | 'pending' | 'confirmed' | 'failed';

export interface UseOptimisticMutationOptions<TVariables, TValue, TContext> {
  /** The write: a save, a delete or a verb, answering either mode. */
  readonly write: (
    variables: TVariables,
  ) => Effect.Effect<WriteResult<TValue>, EntifixFailure>;
  /** Applies the write to what the screen shows, before it is sent. */
  readonly apply?: (variables: TVariables) => TContext;
  /**
   * Undoes `apply`: on a write that failed, and on a flow that failed. It runs
   * for a flow even after the screen that started it unmounted.
   */
  readonly rollback?: (variables: TVariables, context: TContext) => void;
  /** Runs when a flow this mutation started completed. */
  readonly confirm?: (variables: TVariables, context: TContext) => void;
  /** What a pending write means, stored beside it. JSON only. */
  readonly intent?: (variables: TVariables) => unknown;
  /** Defaults to the {@link PendingFlowStoreProvider}'s store. */
  readonly store?: PendingFlowStore;
}

export interface OptimisticMutation<TVariables, TValue> {
  readonly status: OptimisticStatus;
  /** What a settled write answered. */
  readonly value: TValue | undefined;
  /** Why the write or its flow failed, when it said why. */
  readonly failure: unknown;
  readonly flowId: string | undefined;
  /**
   * Sends the write. Resolves with its result in either mode, and rejects
   * with the failure — after rolling back — when the write itself fails.
   */
  readonly mutate: (variables: TVariables) => Promise<WriteResult<TValue>>;
  readonly reset: () => void;
}

interface FlowState {
  readonly flowId: string;
  readonly status: 'pending' | 'confirmed' | 'failed';
  readonly failure?: unknown;
}

/**
 * One mutation API for both settle modes
 * ([ADR 0022](../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 *
 * A settled write behaves as a TanStack Query optimistic mutation: `apply` on
 * mutate, `rollback` when it fails. A pending one records its flow in the
 * pending-flow store and stays `pending` until `usePendingFlowSettlement`
 * settles it: `confirmed`, or `failed` and rolled back. A screen never
 * branches on a status code.
 */
export function useOptimisticMutation<
  TVariables,
  TValue,
  TContext = undefined,
>({
  write,
  apply,
  rollback,
  confirm,
  intent,
  store,
}: UseOptimisticMutationOptions<
  TVariables,
  TValue,
  TContext
>): OptimisticMutation<TVariables, TValue> {
  const provided = usePendingFlowStore();
  const pendingStore = store ?? provided;
  const [flow, setFlow] = useState<FlowState | undefined>(undefined);

  const mutation = useMutation<
    WriteResult<TValue>,
    unknown,
    TVariables,
    TContext
  >({
    mutationFn: variables =>
      Effect.runPromiseExit(write(variables)).then(exit =>
        Exit.isSuccess(exit)
          ? exit.value
          : Promise.reject(Cause.squash(exit.cause)),
      ),
    onMutate: variables => apply?.(variables) as TContext,
    onError: (_failure, variables, context) => {
      rollback?.(variables, context as TContext);
    },
    onSuccess: (result, variables, context) => {
      if (result._tag === 'settled') return;
      if (pendingStore === undefined)
        throw new Error(
          `flow '${result.flowId}' was accepted but no PendingFlowStore is provided to wait for it`,
        );
      const status = flowLink(result, 'status');
      pendingStore.add({
        flowId: result.flowId,
        ...(status === undefined ? {} : { status }),
        ...(intent === undefined ? {} : { intent: intent(variables) }),
      });
      setFlow({ flowId: result.flowId, status: 'pending' });
      pendingStore.onSettled(result.flowId, (outcome: FlowOutcome) => {
        if (outcome.kind === 'confirmed') confirm?.(variables, context);
        else rollback?.(variables, context);
        setFlow({
          flowId: result.flowId,
          status: outcome.kind === 'confirmed' ? 'confirmed' : 'failed',
          ...(outcome.kind === 'failed' ? { failure: outcome.failure } : {}),
        });
      });
    },
  });

  const { mutateAsync, reset: resetMutation } = mutation;
  const mutate = useCallback(
    (variables: TVariables) => {
      setFlow(undefined);
      return mutateAsync(variables);
    },
    [mutateAsync],
  );
  const reset = useCallback(() => {
    setFlow(undefined);
    resetMutation();
  }, [resetMutation]);

  const status: OptimisticStatus =
    mutation.status === 'pending'
      ? 'running'
      : mutation.status === 'error'
        ? 'failed'
        : mutation.status === 'idle'
          ? 'idle'
          : (flow?.status ?? 'settled');

  return {
    status,
    value: mutation.data?._tag === 'settled' ? mutation.data.value : undefined,
    failure: mutation.error ?? flow?.failure,
    flowId: flow?.flowId,
    mutate,
    reset,
  };
}
