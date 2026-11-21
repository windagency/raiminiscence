/**
 * Marks a throw as a deliberate, expected domain failure (bad input shape, an
 * id that doesn't resolve, a state that doesn't allow the requested
 * operation) as opposed to a bug or infrastructure failure. `server.ts`'s
 * `handle()` returns an `OperationalError`'s message to the client verbatim;
 * anything else is logged in full and masked behind a generic message.
 */
export class OperationalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OperationalError";
  }
}
