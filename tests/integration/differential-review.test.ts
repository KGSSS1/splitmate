import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { groupBalances, pairBalances } from "@/lib/accounting/balances";
import { AccountingError } from "@/lib/accounting/errors";
import { splitItemized } from "@/lib/accounting/itemized";
import {
  amendExpenseEntries,
  buildExpenseEntries,
  buildSettlementEntries,
  cancelExpenseEntries,
  type ExpenseLedgerInput,
  reverseEntries,
  type SettlementLedgerInput,
} from "@/lib/accounting/ledger";
import { allocatePairwise } from "@/lib/accounting/pairwise";
import { splitEqual, splitExact, splitPercentage, splitShares } from "@/lib/accounting/splits";
import type { Balance, LedgerEntry, Payer, Share, SettlementStatus } from "@/lib/accounting/types";
import type { AdjustmentKind, SplitMethod } from "@/lib/expenses/options";
import { buildExpensePayload } from "@/lib/expenses/payload";
import type { ResolvedExpense, ResolvedItem } from "@/lib/expenses/resolve";
import { initialSettlementStatus, type SettlementAction, transitionSettlement } from "@/lib/settlements/lifecycle";
import { simplifyDebts } from "@/lib/settlements/simplify";
import type { Database } from "@/types/database.types";

import { adminClient, createTestUser, deleteTestUsers, signedInClient, type TestUser } from "./support/supabase";

/**
 * Differential test (independent review A): random sequences of expenses
 * (every split method, multiple payers, four currencies with exponents 0, 2
 * and 3), edits, cancellations, stale edits, idempotent retries and
 * settlements (recorded by payer or receiver, confirmed, rejected, cancelled,
 * and "settle up everything") are applied through the real RPC functions as
 * signed-in synthetic users. The same sequence is replayed through
 * src/lib/accounting, and the database must agree with it:
 *
 *  - the raw ledger rows (exact multiset, including reversals),
 *  - group_balances, my_group_balances, friend_balances, friend_group_balances
 *    and group_pairwise_balances,
 *  - an independent oracle: net = Σ active expenses (paid − share)
 *    + Σ completed settlements (payer +, receiver −), which does not use the
 *    pairwise allocation at all,
 *  - every group nets to zero per currency,
 *  - the settlement state machine (allowed / rejected, and the SQLSTATE).
 *
 * Fixed seed for reproducibility: DIFF_SEED=<n> overrides it.
 */
const SEED = Number(process.env.DIFF_SEED ?? 20261022);
const SEQUENCES = Number(process.env.DIFF_SEQUENCES ?? 6);
const OPS_PER_SEQUENCE = Number(process.env.DIFF_OPS ?? 45);
const USER_COUNT = 5;
const CURRENCIES = ["INR", "JPY", "KWD", "USD"] as const;
const MAX_AMOUNT: Record<(typeof CURRENCIES)[number], number> = { INR: 500_000, JPY: 50_000, KWD: 2_000_000, USD: 300_000 };

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  }
  subset<T>(items: readonly T[], min: number): T[] {
    const size = this.int(Math.min(min, items.length), items.length);
    return this.shuffle(items).slice(0, size);
  }
  /** Splits `total` into `parts` non-negative (or positive) integers. */
  partition(total: number, parts: number, positive: boolean): number[] {
    const base = positive ? 1 : 0;
    let rest = total - base * parts;
    const out: number[] = [];
    for (let i = 0; i < parts - 1; i += 1) {
      const take = this.chance(0.15) ? 0 : this.int(0, rest);
      out.push(base + take);
      rest -= take;
    }
    out.push(base + rest);
    return this.shuffle(out);
  }
  uuid(): string {
    const hex = Array.from({ length: 32 }, () => this.int(0, 15).toString(16));
    hex[12] = "4";
    hex[16] = "89ab"[this.int(0, 3)] ?? "8";
    const s = hex.join("");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
}

// ---------------------------------------------------------------------------
// Model state (what src/lib/accounting says the database should contain)
// ---------------------------------------------------------------------------

interface ModelExpense {
  id: string;
  groupId: string | null;
  creator: string;
  key: string;
  status: "active" | "cancelled";
  current: ExpenseLedgerInput;
  /** Group members (or the two friends) who may act on it. */
  people: string[];
}

interface ModelSettlement extends SettlementLedgerInput {
  createdBy: string;
  key: string;
  /** Group members (or the two friends) for picking outsiders. */
  people: string[];
}

interface Context {
  groupId: string | null;
  people: string[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function entryKey(e: LedgerEntry): string {
  return [e.source.kind, e.source.id, e.source.version, e.entryType, e.debtorId, e.creditorId, e.amount, e.currency, e.groupId ?? "direct"].join("|");
}

function sortedKeys(entries: readonly LedgerEntry[]): string[] {
  return entries.map(entryKey).sort(compare);
}

function sortBalances(rows: readonly Balance[]): Balance[] {
  return [...rows].sort((a, b) => compare(a.currency, b.currency) || compare(a.userId, b.userId));
}

/** Independent of the pairwise allocation: nets straight from payers, shares and completed settlements. */
function oracleNets(expenses: readonly ModelExpense[], settlements: readonly ModelSettlement[], groupId: string): Balance[] {
  const totals = new Map<string, bigint>();
  const add = (userId: string, currency: string, delta: bigint) => {
    const key = `${currency}|${userId}`;
    totals.set(key, (totals.get(key) ?? 0n) + delta);
  };
  for (const e of expenses) {
    if (e.groupId !== groupId || e.status !== "active") continue;
    for (const p of e.current.payers) add(p.userId, e.current.currency, BigInt(p.amount));
    for (const s of e.current.shares) add(s.userId, e.current.currency, -BigInt(s.amount));
  }
  for (const s of settlements) {
    if (s.groupId !== groupId || s.status !== "completed") continue;
    add(s.payerId, s.currency, BigInt(s.amount));
    add(s.receiverId, s.currency, -BigInt(s.amount));
  }
  return sortBalances(
    [...totals]
      .filter(([, total]) => total !== 0n)
      .map(([key, total]) => {
        const [currency = "", userId = ""] = key.split("|");
        return { userId, currency, amount: Number(total) };
      }),
  );
}

// ---------------------------------------------------------------------------
// Random expenses, built with the accounting module and the app's payload builder
// ---------------------------------------------------------------------------

interface ExpenseSpec {
  resolved: ResolvedExpense;
  ledgerInput: Omit<ExpenseLedgerInput, "expenseId" | "version">;
}

function randomExpense(rng: Rng, ctx: Context): ExpenseSpec | null {
  const currency = rng.pick(CURRENCIES);
  const method = rng.pick<SplitMethod>(["equal", "exact", "percentage", "shares", "itemized"]);
  const direct = ctx.groupId === null;
  // Direct expenses must involve exactly the two friends.
  const participants = direct ? rng.shuffle(ctx.people) : rng.subset(ctx.people, 1);
  const small = rng.chance(0.25);
  const max = small ? 12 : MAX_AMOUNT[currency];

  let total: number;
  let shares: Share[];
  const basisPoints = new Map<string, number>();
  const weights = new Map<string, number>();
  const items: ResolvedItem[] = [];

  try {
    switch (method) {
      case "equal":
        total = rng.int(1, max);
        shares = splitEqual(total, participants);
        break;
      case "exact": {
        total = rng.int(1, max);
        const parts = rng.partition(total, participants.length, false);
        shares = splitExact(
          total,
          participants.map((userId, i) => ({ userId, amount: parts[i] ?? 0 })),
        );
        break;
      }
      case "percentage": {
        total = rng.int(1, max);
        const parts = rng.partition(10_000, participants.length, false);
        participants.forEach((userId, i) => basisPoints.set(userId, parts[i] ?? 0));
        shares = splitPercentage(
          total,
          participants.map((userId) => ({ userId, basisPoints: basisPoints.get(userId) ?? 0 })),
        );
        break;
      }
      case "shares": {
        total = rng.int(1, max);
        participants.forEach((userId) => weights.set(userId, rng.int(1, 5)));
        shares = splitShares(
          total,
          participants.map((userId) => ({ userId, weight: weights.get(userId) ?? 1 })),
        );
        break;
      }
      case "itemized": {
        const itemCount = rng.int(1, 4);
        for (let i = 0; i < itemCount; i += 1) {
          // Direct: both friends must appear, so the first item goes to both.
          const assignees = direct && i === 0 ? [...participants] : rng.subset(participants, 1);
          // Keep the form's order (participant order), as resolveItemized does.
          const ordered = participants.filter((id) => assignees.includes(id));
          items.push({ name: `Item ${i + 1}`, kind: "item", amount: rng.int(1, Math.max(1, Math.floor(max / 2))), assignees: ordered });
        }
        const itemsTotal = items.reduce((acc, item) => acc + item.amount, 0);
        for (const kind of ["tax", "service", "tip", "discount"] as AdjustmentKind[]) {
          if (!rng.chance(0.35)) continue;
          const limit = kind === "discount" ? Math.max(1, Math.floor(itemsTotal / 3)) : Math.max(1, Math.floor(itemsTotal / 5));
          items.push({ name: kind, kind, amount: rng.int(1, limit), allocation: rng.chance(0.3) ? "equal" : "proportional" });
        }
        const result = splitItemized({
          items: items
            .filter((item) => item.kind === "item")
            .map((item) => ({ amount: item.amount, assignments: (item.assignees ?? []).map((userId) => ({ userId })) })),
          adjustments: items
            .filter((item): item is ResolvedItem & { kind: AdjustmentKind } => item.kind !== "item")
            .map((item) => ({ kind: item.kind, amount: item.amount, allocation: item.allocation })),
        });
        total = result.total;
        shares = result.shares;
        break;
      }
    }
  } catch (error) {
    // e.g. an equal discount larger than someone's items: the form rejects it too.
    if (error instanceof AccountingError) return null;
    throw error;
  }

  // Payers: 1–3 people (any member, not only participants), each paying a positive part.
  const payerPool = ctx.people;
  const payerCount = Math.min(rng.int(1, 3), payerPool.length, total);
  const payerIds = rng.shuffle(payerPool).slice(0, payerCount);
  const paid = rng.partition(total, payerCount, true);
  const payers: Payer[] = payerIds.map((userId, i) => ({ userId, amount: paid[i] ?? 0 }));

  const debts = allocatePairwise(payers, shares);
  return {
    resolved: { total, currency, splitMethod: method, payers, shares, basisPoints, weights, items, debts },
    ledgerInput: { groupId: ctx.groupId, currency, total, payers, shares },
  };
}

function expenseArgs(spec: ExpenseSpec, description: string) {
  const { p_items, ...payload } = buildExpensePayload(spec.resolved);
  return {
    ...payload,
    ...(p_items ? { p_items } : {}),
    p_description: description,
    p_expense_date: "2026-10-21",
  };
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

const EXPECTED_CODE: Record<string, string> = {
  NOT_A_PARTY: "SM404",
  NOT_ALLOWED: "SM403",
  INVALID_TRANSITION: "SM409",
};

describe("differential review: database RPCs vs src/lib/accounting", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  const clients = new Map<string, Client>();
  const groups: string[] = [];
  const groupMembers = new Map<string, string[]>();
  const expenses: ModelExpense[] = [];
  const settlements: ModelSettlement[] = [];
  const ledger: LedgerEntry[] = [];
  const trace: string[] = [];
  const codeDifferences = new Set<string>();
  let ids: string[] = [];
  let operations = 0;

  const as = (userId: string): Client => {
    const client = clients.get(userId);
    if (!client) throw new Error(`no client for ${userId}`);
    return client;
  };
  const name = (userId: string) => `U${ids.indexOf(userId)}`;

  function fail(message: string): never {
    throw new Error(`[seed ${SEED}] ${message}\nLast operations:\n${trace.slice(-15).join("\n")}`);
  }

  async function dbLedger(): Promise<LedgerEntry[]> {
    const rows: LedgerEntry[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("ledger_entries")
        .select("debtor_id, creditor_id, amount, currency, group_id, expense_id, settlement_id, source_version, entry_type")
        .in("debtor_id", ids)
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      for (const r of data) {
        rows.push({
          debtorId: r.debtor_id,
          creditorId: r.creditor_id,
          amount: r.amount,
          currency: r.currency,
          groupId: r.group_id,
          source: r.expense_id
            ? { kind: "expense", id: r.expense_id, version: r.source_version }
            : { kind: "settlement", id: r.settlement_id ?? "", version: r.source_version },
          entryType: r.entry_type === "reversal" ? "reversal" : "charge",
        });
      }
      if (data.length < 1000) break;
    }
    return rows;
  }

  async function checkGroup(groupId: string, viewer: string) {
    const { data, error } = await as(viewer).rpc("group_balances", { p_group_id: groupId });
    if (error) throw error;
    const db = sortBalances(data.map((r) => ({ userId: r.user_id, currency: r.currency, amount: r.amount })));
    const engine = sortBalances(groupBalances(ledger, groupId));
    const oracle = oracleNets(expenses, settlements, groupId);
    if (JSON.stringify(db) !== JSON.stringify(engine)) {
      fail(`group_balances differs from the engine\nDB:     ${JSON.stringify(db)}\nengine: ${JSON.stringify(engine)}`);
    }
    if (JSON.stringify(engine) !== JSON.stringify(oracle)) {
      fail(`engine differs from the payer/share oracle\nengine: ${JSON.stringify(engine)}\noracle: ${JSON.stringify(oracle)}`);
    }
    const perCurrency = new Map<string, bigint>();
    for (const row of db) perCurrency.set(row.currency, (perCurrency.get(row.currency) ?? 0n) + BigInt(row.amount));
    for (const [currency, sum] of perCurrency) {
      if (sum !== 0n) fail(`group ${groupId} does not net to zero in ${currency}: ${sum}`);
    }
  }

  async function checkEverything() {
    // 1. Raw ledger rows: exact multiset.
    const rows = await dbLedger();
    const dbKeys = sortedKeys(rows);
    const modelKeys = sortedKeys(ledger);
    if (JSON.stringify(dbKeys) !== JSON.stringify(modelKeys)) {
      const missing = modelKeys.filter((k) => !dbKeys.includes(k)).slice(0, 5);
      const extra = dbKeys.filter((k) => !modelKeys.includes(k)).slice(0, 5);
      fail(`ledger rows differ (db ${dbKeys.length}, model ${modelKeys.length})\nmissing: ${missing.join("\n")}\nextra: ${extra.join("\n")}`);
    }
    // 2. Every group: balances, oracle and zero sum.
    for (const groupId of groups) await checkGroup(groupId, ids[0] ?? "");
    // 3. Per user: friend balances, per-group nets and per-friend-per-group balances.
    for (const userId of ids) {
      const friends = await as(userId).rpc("friend_balances");
      if (friends.error) throw friends.error;
      const db = friends.data
        .map((r) => ({ counterpartyId: r.friend_id, currency: r.currency, amount: r.amount }))
        .sort((a, b) => compare(a.counterpartyId, b.counterpartyId) || compare(a.currency, b.currency));
      const engine = pairBalances(ledger, userId);
      if (JSON.stringify(db) !== JSON.stringify(engine)) {
        fail(`friend_balances for ${name(userId)} differs\nDB:     ${JSON.stringify(db)}\nengine: ${JSON.stringify(engine)}`);
      }

      const mine = await as(userId).rpc("my_group_balances");
      if (mine.error) throw mine.error;
      const expectedMine = groups
        .flatMap((g) => groupBalances(ledger, g).filter((b) => b.userId === userId).map((b) => ({ group_id: g, currency: b.currency, amount: b.amount })))
        .sort((a, b) => compare(a.group_id, b.group_id) || compare(a.currency, b.currency));
      const dbMine = [...mine.data].sort((a, b) => compare(a.group_id, b.group_id) || compare(a.currency, b.currency));
      if (JSON.stringify(dbMine) !== JSON.stringify(expectedMine)) {
        fail(`my_group_balances for ${name(userId)} differs\nDB:     ${JSON.stringify(dbMine)}\nengine: ${JSON.stringify(expectedMine)}`);
      }

      for (const friendId of ids) {
        if (friendId === userId) continue;
        const fg = await as(userId).rpc("friend_group_balances", { p_friend_id: friendId });
        if (fg.error) throw fg.error;
        const contexts = [null, ...groups];
        const expected = contexts
          .flatMap((g) =>
            pairBalances(
              ledger.filter((e) => e.groupId === g),
              userId,
            )
              .filter((b) => b.counterpartyId === friendId)
              .map((b) => ({ group_id: g, currency: b.currency, amount: b.amount })),
          )
          .map((r) => JSON.stringify(r))
          .sort(compare);
        const got = fg.data.map((r) => JSON.stringify({ group_id: r.group_id, currency: r.currency, amount: r.amount })).sort(compare);
        if (JSON.stringify(got) !== JSON.stringify(expected)) {
          fail(`friend_group_balances ${name(userId)}→${name(friendId)} differs\nDB:     ${got.join(",")}\nengine: ${expected.join(",")}`);
        }
      }
    }
    // 4. Pairwise debts per group.
    for (const groupId of groups) {
      const { data, error } = await as(ids[0] ?? "").rpc("group_pairwise_balances", { p_group_id: groupId });
      if (error) throw error;
      const expected: string[] = [];
      const groupEntries = ledger.filter((e) => e.groupId === groupId);
      for (const debtorId of ids) {
        for (const b of pairBalances(groupEntries, debtorId)) {
          if (b.amount < 0) expected.push(JSON.stringify([debtorId, b.counterpartyId, b.currency, -b.amount]));
        }
      }
      const got = data.map((r) => JSON.stringify([r.debtor_id, r.creditor_id, r.currency, r.amount]));
      if (JSON.stringify(got.sort(compare)) !== JSON.stringify(expected.sort(compare))) {
        fail(`group_pairwise_balances for ${groupId} differs\nDB:     ${got.join(",")}\nengine: ${expected.join(",")}`);
      }
    }
  }

  beforeAll(async () => {
    const created = await Promise.all(
      Array.from({ length: USER_COUNT }, (_, i) => createTestUser(admin, { displayName: `Diff ${i}` })),
    );
    users.push(...created);
    ids = created.map((u) => u.id);
    for (const user of created) clients.set(user.id, await signedInClient(user));
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it(
    `random sequences agree with the accounting engine (seed ${SEED})`,
    async () => {
      const rng = new Rng(SEED);

      for (let seq = 0; seq < SEQUENCES; seq += 1) {
        // A new group with 3–5 of the users; U0 always creates it.
        const owner = ids[0] ?? "";
        const members = [owner, ...rng.subset(ids.slice(1), 2)];
        const group = await as(owner).rpc("create_group", { p_name: `Diff ${SEED}-${seq}` });
        if (group.error) throw group.error;
        const groupId = group.data;
        groups.push(groupId);
        groupMembers.set(groupId, members);
        const invite = await as(owner).rpc("create_invitation", { p_group_id: groupId, p_max_uses: members.length });
        if (invite.error) throw invite.error;
        for (const member of members.slice(1)) {
          const joined = await as(member).rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
          if (joined.error) throw joined.error;
        }
        // Everyone in any group so far is friends with the owner; direct pairs come from this group.
        const groupCtx: Context = { groupId, people: members };
        trace.push(`seq ${seq}: group ${groupId} with ${members.map(name).join(",")}`);

        for (let op = 0; op < OPS_PER_SEQUENCE; op += 1) {
          operations += 1;
          const roll = rng.int(1, 100);
          const direct = rng.chance(0.2);
          const ctx: Context = direct ? { groupId: null, people: rng.shuffle(members).slice(0, 2) } : groupCtx;
          const active = expenses.filter((e) => e.status === "active");

          if (roll <= 26 || expenses.length === 0) {
            // Create an expense.
            const spec = randomExpense(rng, ctx);
            if (!spec) continue;
            const actor = rng.pick(ctx.people);
            const key = rng.uuid();
            const { data: id, error } = await as(actor).rpc("create_expense", {
              ...expenseArgs(spec, `Diff ${seq}.${op}`),
              p_idempotency_key: key,
              p_group_id: ctx.groupId ?? (null as unknown as string),
            });
            trace.push(`${seq}.${op} create ${spec.resolved.splitMethod} ${spec.resolved.total} ${spec.resolved.currency} by ${name(actor)} in ${ctx.groupId ? "group" : "direct"} payers=${JSON.stringify(spec.resolved.payers.map((p) => [name(p.userId), p.amount]))} shares=${JSON.stringify(spec.resolved.shares.map((s) => [name(s.userId), s.amount]))} → ${error?.code ?? id}`);
            if (error) fail(`create_expense rejected a valid expense: ${error.code} ${error.message}`);
            const current: ExpenseLedgerInput = { ...spec.ledgerInput, expenseId: id, version: 1 };
            ledger.push(...buildExpenseEntries(current));
            expenses.push({ id, groupId: ctx.groupId, creator: actor, key, status: "active", current, people: ctx.people });
          } else if (roll <= 40 && active.length > 0) {
            // Edit an active expense (new amount, currency, split, payers).
            const target = rng.pick(active);
            const spec = randomExpense(rng, { groupId: target.groupId, people: target.people });
            if (!spec) continue;
            const actor = rng.pick(target.people);
            const { data, error } = await as(actor).rpc("update_expense", {
              ...expenseArgs(spec, `Diff edit ${seq}.${op}`),
              p_expense_id: target.id,
              p_expected_version: target.current.version,
            });
            trace.push(`${seq}.${op} edit ${target.id} v${target.current.version} → ${spec.resolved.splitMethod} ${spec.resolved.total} ${spec.resolved.currency} by ${name(actor)} → ${error?.code ?? data}`);
            if (error) fail(`update_expense rejected a valid edit: ${error.code} ${error.message}`);
            const next: ExpenseLedgerInput = { ...spec.ledgerInput, expenseId: target.id, version: target.current.version + 1 };
            expect(data).toBe(next.version);
            ledger.push(...amendExpenseEntries(target.current, next));
            target.current = next;
          } else if (roll <= 47 && active.length > 0) {
            // Cancel an active expense.
            const target = rng.pick(active);
            const actor = rng.pick(target.people);
            const { error } = await as(actor).rpc("cancel_expense", {
              p_expense_id: target.id,
              p_expected_version: target.current.version,
            });
            trace.push(`${seq}.${op} cancel ${target.id} v${target.current.version} by ${name(actor)} → ${error?.code ?? "ok"}`);
            if (error) fail(`cancel_expense failed: ${error.code} ${error.message}`);
            ledger.push(...cancelExpenseEntries(target.current));
            target.status = "cancelled";
          } else if (roll <= 51 && expenses.length > 0) {
            // A stale or post-cancel change must be refused without touching the ledger.
            const target = rng.pick(expenses);
            const stale = target.status === "active" ? target.current.version + (rng.chance(0.5) ? 1 : -1) : target.current.version;
            const actor = rng.pick(target.people);
            let code: string | undefined;
            if (rng.chance(0.5)) {
              const spec = randomExpense(rng, { groupId: target.groupId, people: target.people });
              if (!spec) continue;
              code = (
                await as(actor).rpc("update_expense", {
                  ...expenseArgs(spec, "stale"),
                  p_expense_id: target.id,
                  p_expected_version: stale,
                })
              ).error?.code;
            } else {
              code = (await as(actor).rpc("cancel_expense", { p_expense_id: target.id, p_expected_version: stale })).error?.code;
            }
            trace.push(`${seq}.${op} stale change ${target.id} (${target.status}) expected v${stale} → ${code ?? "ok"}`);
            if (code !== "SM409") fail(`stale/cancelled change returned ${code ?? "success"}, expected SM409`);
          } else if (roll <= 54 && expenses.length > 0) {
            // Retry a create with the same idempotency key (and a different payload): same ID, nothing new.
            const target = rng.pick(expenses);
            const spec = randomExpense(rng, { groupId: target.groupId, people: target.people });
            if (!spec) continue;
            const { data, error } = await as(target.creator).rpc("create_expense", {
              ...expenseArgs(spec, "retry"),
              p_idempotency_key: target.key,
              p_group_id: target.groupId ?? (null as unknown as string),
            });
            trace.push(`${seq}.${op} retry create ${target.id} → ${error?.code ?? data}`);
            if (error || data !== target.id) fail(`idempotent retry returned ${error?.code ?? data}, expected ${target.id}`);
          } else if (roll <= 72) {
            // Record a settlement (by the payer → pending, by the receiver → completed).
            const [payerId = "", receiverId = ""] = rng.shuffle(ctx.people);
            const currency = rng.pick(CURRENCIES);
            const owed = pairBalances(
              ledger.filter((e) => e.groupId === ctx.groupId),
              receiverId,
            ).find((b) => b.counterpartyId === payerId && b.currency === currency);
            const amount =
              owed && owed.amount > 0 && rng.chance(0.5)
                ? rng.chance(0.5)
                  ? owed.amount
                  : rng.int(1, owed.amount)
                : rng.int(1, rng.chance(0.3) ? 9 : MAX_AMOUNT[currency] / 4);
            const recorder = rng.chance(0.5) ? payerId : receiverId;
            const key = rng.uuid();
            const { data: id, error } = await as(recorder).rpc("create_settlement", {
              p_idempotency_key: key,
              p_group_id: ctx.groupId ?? (null as unknown as string),
              p_payer_id: payerId,
              p_receiver_id: receiverId,
              p_amount: amount,
              p_currency: currency,
              p_method: rng.pick(["cash", "bank_transfer", "upi", "other"]),
            });
            trace.push(`${seq}.${op} settlement ${name(payerId)}→${name(receiverId)} ${amount} ${currency} recorded by ${name(recorder)} in ${ctx.groupId ? "group" : "direct"} → ${error?.code ?? id}`);
            if (error) fail(`create_settlement failed: ${error.code} ${error.message}`);
            const outcome = initialSettlementStatus({ payerId, receiverId }, recorder);
            const model: ModelSettlement = {
              settlementId: id,
              payerId,
              receiverId,
              amount,
              currency,
              groupId: ctx.groupId,
              status: outcome.status,
              createdBy: recorder,
              key,
              people: groupCtx.people,
            };
            const { data: row } = await admin.from("settlements").select("status").eq("id", id).single();
            if (row?.status !== outcome.status) fail(`settlement status ${row?.status}, engine says ${outcome.status}`);
            ledger.push(...buildSettlementEntries(model));
            settlements.push(model);
          } else if (roll <= 92 && settlements.length > 0) {
            // Confirm / reject / cancel by payer, receiver or an outsider.
            const target = rng.pick(settlements);
            const action = rng.pick<SettlementAction>(["confirm", "reject", "cancel"]);
            const outsiders = target.people.filter((p) => p !== target.payerId && p !== target.receiverId);
            const who = rng.int(0, 4);
            const actor = who <= 1 ? target.payerId : who <= 3 || outsiders.length === 0 ? target.receiverId : rng.pick(outsiders);
            let expected: { ok: true; status: SettlementStatus; effect: string } | { ok: false; code: string };
            try {
              const outcome = transitionSettlement(target, action, actor);
              expected = { ok: true, status: outcome.status, effect: outcome.ledgerEffect };
            } catch (error) {
              if (!(error instanceof AccountingError)) throw error;
              expected = { ok: false, code: EXPECTED_CODE[error.code] ?? error.code };
            }
            const fn = `${action}_settlement` as const;
            const { error } = await as(actor).rpc(fn, { p_settlement_id: target.settlementId });
            trace.push(`${seq}.${op} ${action} ${target.settlementId} (${target.status}) by ${name(actor)} → ${error?.code ?? "ok"} (engine: ${expected.ok ? `ok ${expected.status}` : expected.code})`);
            if (expected.ok) {
              if (error) fail(`${fn} refused an allowed transition: ${error.code} ${error.message}`);
              if (expected.effect === "apply") ledger.push(...buildSettlementEntries({ ...target, status: "completed" }));
              if (expected.effect === "reverse") ledger.push(...reverseEntries(buildSettlementEntries({ ...target, status: "completed" })));
              target.status = expected.status;
            } else if (!error) {
              fail(`${fn} allowed a transition the engine refuses (${expected.code})`);
            } else if (error.code !== expected.code) {
              // Both refuse; only the reason differs (the DB checks the role before the status).
              codeDifferences.add(`${action} ${target.status} by ${actor === target.payerId ? "payer" : actor === target.receiverId ? "receiver" : "outsider"}: db ${error.code}, engine ${expected.code}`);
            }
          } else if (roll <= 95 && settlements.length > 0) {
            // Retry a settlement with the same key: same ID, nothing new.
            const target = rng.pick(settlements);
            const { data, error } = await as(target.createdBy).rpc("create_settlement", {
              p_idempotency_key: target.key,
              p_group_id: target.groupId ?? (null as unknown as string),
              p_payer_id: target.payerId,
              p_receiver_id: target.receiverId,
              p_amount: target.amount + 1,
              p_currency: target.currency,
            });
            trace.push(`${seq}.${op} retry settlement ${target.settlementId} → ${error?.code ?? data}`);
            if (error || data !== target.settlementId) fail(`settlement retry returned ${error?.code ?? data}`);
          } else {
            // Settle up everything between two members (all shared groups + direct, per currency).
            // Direct: the raw pairwise balance. Groups (they simplify by default): the
            // transfer between the two in the engine's simplified plan (SPEC §7, §11).
            const [caller = "", friend = ""] = rng.shuffle(members);
            const key = rng.uuid();
            const expectedRows: ModelSettlement[] = [];
            const items: { group_id: string | null; currency: string; amount: number }[] = [];
            for (const g of [null, ...groups]) {
              const people = g === null ? [caller, friend] : (groupMembers.get(g) ?? []);
              if (!people.includes(caller) || !people.includes(friend)) continue;
              const between =
                g === null
                  ? pairBalances(
                      ledger.filter((e) => e.groupId === null),
                      caller,
                    ).filter((b) => b.counterpartyId === friend)
                  : simplifyDebts(groupBalances(ledger, g)).flatMap((t) =>
                      t.toUserId === caller && t.fromUserId === friend
                        ? [{ counterpartyId: friend, currency: t.currency, amount: t.amount }]
                        : t.fromUserId === caller && t.toUserId === friend
                          ? [{ counterpartyId: friend, currency: t.currency, amount: -t.amount }]
                          : [],
                    );
              const ctxPeople = people;
              for (const b of between) {
                // SPEC §11 (review L2): a debt with a pending payment between the two is left out.
                const pendingHere = settlements.some(
                  (s) =>
                    s.status === "pending" &&
                    s.groupId === g &&
                    s.currency === b.currency &&
                    [s.payerId, s.receiverId].sort().join() === [caller, friend].sort().join(),
                );
                if (pendingHere) continue;
                items.push({ group_id: g, currency: b.currency, amount: b.amount });
                const payerId = b.amount > 0 ? friend : caller;
                const receiverId = b.amount > 0 ? caller : friend;
                expectedRows.push({
                  settlementId: "",
                  payerId,
                  receiverId,
                  amount: Math.abs(b.amount),
                  currency: b.currency,
                  groupId: g,
                  status: initialSettlementStatus({ payerId, receiverId }, caller).status,
                  createdBy: caller,
                  key: "",
                  people: ctxPeople,
                });
              }
            }
            const { data, error } = await as(caller).rpc("settle_up_with_friend", {
              p_idempotency_key: key,
              p_friend_id: friend,
              p_items: items,
            });
            trace.push(`${seq}.${op} settle up ${name(caller)} with ${name(friend)} (engine expects ${expectedRows.length}) → ${error?.code ?? data?.length}`);
            if (expectedRows.length === 0) {
              if (error?.code !== "SM422") fail(`settle_up_with_friend with nothing owed returned ${error?.code ?? "success"}`);
              continue;
            }
            if (error) fail(`settle_up_with_friend failed: ${error.code} ${error.message}`);
            const { data: rows, error: readError } = await admin
              .from("settlements")
              .select("id, payer_id, receiver_id, amount, currency, group_id, status, idempotency_key")
              .in("id", data);
            if (readError) throw readError;
            const describeRow = (s: { payerId: string; receiverId: string; amount: number; currency: string; groupId: string | null; status: string }) =>
              JSON.stringify([s.groupId, s.currency, s.payerId, s.receiverId, s.amount, s.status]);
            const got = rows.map((r) => describeRow({ payerId: r.payer_id, receiverId: r.receiver_id, amount: r.amount, currency: r.currency, groupId: r.group_id, status: r.status })).sort(compare);
            const want = expectedRows.map(describeRow).sort(compare);
            if (JSON.stringify(got) !== JSON.stringify(want)) fail(`settle_up_with_friend rows differ\nDB:     ${got.join(",")}\nengine: ${want.join(",")}`);
            for (const r of rows) {
              const model = expectedRows.find((m) => describeRow(m) === describeRow({ payerId: r.payer_id, receiverId: r.receiver_id, amount: r.amount, currency: r.currency, groupId: r.group_id, status: r.status }));
              if (!model) continue;
              model.settlementId = r.id;
              model.key = r.idempotency_key;
              ledger.push(...buildSettlementEntries(model));
              settlements.push(model);
            }
            // A retry with the same key returns the same settlements and changes nothing.
            const retry = await as(caller).rpc("settle_up_with_friend", {
              p_idempotency_key: key,
              p_friend_id: friend,
              p_items: [],
            });
            if ([...(retry.data ?? [])].sort(compare).join() !== [...data].sort(compare).join()) fail("settle-up retry returned different settlements");
          }

          await checkGroup(groupId, owner);
        }
        await checkEverything();
      }
      trace.push(`done: ${operations} operations, ${expenses.length} expenses, ${settlements.length} settlements, ${ledger.length} ledger rows`);
      console.info(`[differential-review] seed ${SEED}: ${SEQUENCES} sequences, ${operations} operations, ${expenses.length} expenses, ${settlements.length} settlements, ${ledger.length} ledger rows`);
      if (codeDifferences.size > 0) {
        console.info(`[differential-review] refusal codes that differ from the engine: ${[...codeDifferences].sort(compare).join("; ")}`);
      }
      expect(ledger.length).toBeGreaterThan(0);
    },
    600_000,
  );

  it("concurrent edits, retries and settlement transitions stay consistent", async () => {
    const rng = new Rng(SEED + 1);
    const [a = "", b = "", c = ""] = ids;
    const group = await as(a).rpc("create_group", { p_name: `Diff race ${SEED}` });
    if (group.error) throw group.error;
    const groupId = group.data;
    groups.push(groupId);
    const invite = await as(a).rpc("create_invitation", { p_group_id: groupId, p_max_uses: 2 });
    if (invite.error) throw invite.error;
    for (const member of [b, c]) {
      const joined = await as(member).rpc("accept_invitation", { p_token: invite.data[0]?.token ?? "" });
      if (joined.error) throw joined.error;
    }
    const ctx: Context = { groupId, people: [a, b, c] };
    const spec = (): ExpenseSpec => {
      for (;;) {
        const s = randomExpense(rng, ctx);
        if (s) return s;
      }
    };

    // 1. Five concurrent creates with one idempotency key → one expense.
    const key = rng.uuid();
    const first = spec();
    const creates = await Promise.all(
      Array.from({ length: 5 }, () =>
        as(a).rpc("create_expense", { ...expenseArgs(first, "race create"), p_idempotency_key: key, p_group_id: groupId }),
      ),
    );
    const createdIds = new Set(creates.map((r) => r.data));
    expect(creates.map((r) => r.error)).toEqual([null, null, null, null, null]);
    expect(createdIds.size).toBe(1);
    const expenseId = creates[0]?.data ?? "";
    let current: ExpenseLedgerInput = { ...first.ledgerInput, expenseId, version: 1 };
    ledger.push(...buildExpenseEntries(current));
    const model: ModelExpense = { id: expenseId, groupId, creator: a, key, status: "active", current, people: ctx.people };
    expenses.push(model);

    // 2. Three members edit version 1 at the same time → exactly one wins.
    const edits = [spec(), spec(), spec()];
    const results = await Promise.all(
      edits.map((s, i) =>
        as(ctx.people[i] ?? a).rpc("update_expense", { ...expenseArgs(s, `race edit ${i}`), p_expense_id: expenseId, p_expected_version: 1 }),
      ),
    );
    const winners = results.flatMap((r, i) => (r.error ? [] : [i]));
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.error).map((r) => r.error?.code)).toEqual(["SM409", "SM409"]);
    const winner = edits[winners[0] ?? 0];
    if (!winner) throw new Error("no winner");
    const next: ExpenseLedgerInput = { ...winner.ledgerInput, expenseId, version: 2 };
    ledger.push(...amendExpenseEntries(current, next));
    current = next;
    model.current = next;

    // 3. Cancel and edit race on version 2 → exactly one wins.
    const race = await Promise.all([
      as(b).rpc("cancel_expense", { p_expense_id: expenseId, p_expected_version: 2 }),
      as(c).rpc("update_expense", { ...expenseArgs(edits[0] ?? first, "race edit 2"), p_expense_id: expenseId, p_expected_version: 2 }),
    ]);
    expect(race.filter((r) => !r.error)).toHaveLength(1);
    if (!race[0]?.error) {
      ledger.push(...cancelExpenseEntries(current));
      model.status = "cancelled";
    } else {
      const v3: ExpenseLedgerInput = { ...(edits[0] ?? first).ledgerInput, expenseId, version: 3 };
      ledger.push(...amendExpenseEntries(current, v3));
      model.current = v3;
    }

    // 4. A pending settlement confirmed three times at once and cancelled by the payer → one outcome.
    const pendingKey = rng.uuid();
    const recorded = await Promise.all(
      Array.from({ length: 4 }, () =>
        as(b).rpc("create_settlement", {
          p_idempotency_key: pendingKey,
          p_group_id: groupId,
          p_payer_id: b,
          p_receiver_id: a,
          p_amount: 1234,
          p_currency: "KWD",
        }),
      ),
    );
    expect(new Set(recorded.map((r) => r.data)).size).toBe(1);
    const settlementId = recorded[0]?.data ?? "";
    const settlement: ModelSettlement = {
      settlementId,
      payerId: b,
      receiverId: a,
      amount: 1234,
      currency: "KWD",
      groupId,
      status: "pending",
      createdBy: b,
      key: pendingKey,
      people: ctx.people,
    };
    settlements.push(settlement);
    const transitions = await Promise.all(
      Array.from({ length: 4 }, () => as(a).rpc("confirm_settlement", { p_settlement_id: settlementId })),
    );
    expect(transitions.filter((r) => !r.error)).toHaveLength(1);
    expect(transitions.filter((r) => r.error).map((r) => r.error?.code)).toEqual(["SM409", "SM409", "SM409"]);
    ledger.push(...buildSettlementEntries({ ...settlement, status: "completed" }));
    settlement.status = "completed";

    // 5. Both parties cancel the completed settlement at once → one reversal.
    const cancels = await Promise.all([
      as(a).rpc("cancel_settlement", { p_settlement_id: settlementId }),
      as(b).rpc("cancel_settlement", { p_settlement_id: settlementId }),
      as(a).rpc("cancel_settlement", { p_settlement_id: settlementId }),
    ]);
    expect(cancels.filter((r) => !r.error)).toHaveLength(1);
    ledger.push(...reverseEntries(buildSettlementEntries({ ...settlement, status: "completed" })));
    settlement.status = "cancelled";

    // 6. Receiver confirms while the payer withdraws: either order is valid, never a half state.
    for (let round = 0; round < 5; round += 1) {
      const raceKey = rng.uuid();
      const created = await as(c).rpc("create_settlement", {
        p_idempotency_key: raceKey,
        p_group_id: groupId,
        p_payer_id: c,
        p_receiver_id: b,
        p_amount: 777 + round,
        p_currency: "JPY",
      });
      if (created.error) throw created.error;
      const s: ModelSettlement = {
        settlementId: created.data,
        payerId: c,
        receiverId: b,
        amount: 777 + round,
        currency: "JPY",
        groupId,
        status: "pending",
        createdBy: c,
        key: raceKey,
        people: ctx.people,
      };
      settlements.push(s);
      const [confirm, withdraw] = await Promise.all([
        as(b).rpc("confirm_settlement", { p_settlement_id: s.settlementId }),
        as(c).rpc("cancel_settlement", { p_settlement_id: s.settlementId }),
      ]);
      const { data: row } = await admin.from("settlements").select("status").eq("id", s.settlementId).single();
      if (!confirm.error) ledger.push(...buildSettlementEntries({ ...s, status: "completed" }));
      // Cancelling after the confirmation reverses it; cancelling first leaves nothing to reverse.
      if (!confirm.error && !withdraw.error) ledger.push(...reverseEntries(buildSettlementEntries({ ...s, status: "completed" })));
      expect(confirm.error && withdraw.error).toBeFalsy();
      s.status = (row?.status ?? "pending") as SettlementStatus;
      expect(s.status).toBe(withdraw.error ? "completed" : confirm.error ? "withdrawn" : "cancelled");
    }

    await checkEverything();
  });
});
