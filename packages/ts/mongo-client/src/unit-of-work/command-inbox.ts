import { Effect, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

import { translateMongoFault } from '../errors/translate-mongo-error.js';

/**
 * Where a participant records the command ids it has acted on — in the
 * database its own writes go to, so the claim and the write are one fact.
 *
 * The command-side twin of the inbox. A bus consumer dedupes on
 * `(consumer, eventId)`; a participant answering a dispatched command dedupes
 * on the command id alone, because a command has exactly one addressee. And
 * unlike the inbox it remembers an answer: a redelivered capture must be told
 * what the first delivery decided, not merely that there was one.
 */
export const COMMAND_INBOX_COLLECTION = 'command_inbox';

/** The stored shape of a command claim. */
export interface CommandClaim {
  readonly commandId: string;
  readonly claimedAt: string;
  /** What a duplicate is answered with, when the claiming unit asked for one. */
  readonly replay?: unknown;
}

/** The unique index the claim rides. */
export const ensureCommandInboxIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection<CommandClaim>(COMMAND_INBOX_COLLECTION)
        .createIndex({ commandId: 1 }, { unique: true, name: 'commandId_1' });
    },
    catch: error => translateMongoFault(error),
  });

/** The claim document a unit inserts inside its session. */
export const commandClaimDocument = (commandId: string): CommandClaim => ({
  commandId,
  claimedAt: new Date().toISOString(),
});

/**
 * Stores what a duplicate of `commandId` is answered with, inside the session
 * that took the claim.
 */
export const rememberCommandReplay = (
  db: Db,
  session: ClientSession,
  commandId: string,
  replay: unknown,
) =>
  db
    .collection<CommandClaim>(COMMAND_INBOX_COLLECTION)
    .updateOne({ commandId }, { $set: { replay } }, { session });

/** What the run that took `commandId` asked to be remembered. */
export const readCommandReplay = (db: Db, commandId: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .collection<CommandClaim>(COMMAND_INBOX_COLLECTION)
        .findOne({ commandId }, { projection: { _id: 0 } }),
    catch: error => translateMongoFault(error),
  }).pipe(
    Effect.map(claim =>
      claim === null || claim.replay === undefined
        ? Option.none()
        : Option.some(claim.replay),
    ),
  );
