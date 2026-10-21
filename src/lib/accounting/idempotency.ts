/**
 * Client-generated idempotency keys (SPEC §6). The database enforces
 * uniqueness per creator; retries reuse the same key so a duplicate
 * submission cannot create a second expense or settlement.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function isIdempotencyKey(value: string): boolean {
  return UUID_V4.test(value);
}
