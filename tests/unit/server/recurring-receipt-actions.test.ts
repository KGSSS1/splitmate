// @vitest-environment node
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { todayIn } from "@/lib/expenses/dates";
import { blankExpenseValues } from "@/lib/expenses/form-values";
import { addDays } from "@/lib/recurring/schedule";
import { attachReceipt, deleteReceipt, prepareReceiptUpload } from "@/server/actions/receipts";
import { createRecurringExpense, setRecurringStatus, updateRecurringExpense } from "@/server/actions/recurring";

// M7: recurring and receipt actions with the database and Storage mocked.

const ME = "11111111-1111-4111-8111-111111111111";
const BINA = "22222222-2222-4222-8222-222222222222";
const GROUP = "44444444-4444-4444-8444-444444444444";
const EXPENSE = "55555555-5555-4555-8555-555555555555";
const RECURRING = "66666666-6666-4666-8666-666666666666";
const OBJECT = `${EXPENSE}/77777777-7777-4777-8777-777777777777.pdf`;

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  count: vi.fn(),
  insert: vi.fn(),
  deleted: vi.fn(),
  signUpload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/auth", () => ({
  requireUser: async () => ({ id: ME, email: null }),
  requireOnboardedProfile: async () => ({ id: ME }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: state.rpc,
    from: () => ({
      select: () => ({ eq: state.count }),
      insert: state.insert,
      delete: () => ({ eq: () => ({ eq: () => ({ select: state.deleted }) }) }),
    }),
    storage: {
      from: () => ({ createSignedUploadUrl: state.signUpload, download: state.download, remove: state.remove }),
    },
  }),
}));

const TIME_ZONE = "Asia/Kolkata";
const today = todayIn(TIME_ZONE);

const values = (overrides: Record<string, unknown> = {}) => ({
  ...blankExpenseValues({ splitWith: `group:${GROUP}`, userIds: [ME, BINA], paidBy: ME, currency: "INR", date: today }),
  description: " Rent ",
  amount: "20000",
  repeat: { frequency: "monthly", endDate: "", timezone: TIME_ZONE },
  ...overrides,
});

const pdf = (text = "%PDF-1.7\n...") => new Blob([text], { type: "application/pdf" });

beforeEach(() => {
  state.rpc.mockReset().mockResolvedValue({ data: RECURRING, error: null });
  state.count.mockReset().mockResolvedValue({ count: 0, error: null });
  state.insert.mockReset().mockResolvedValue({ error: null });
  state.deleted.mockReset().mockResolvedValue({ data: [{ storage_path: OBJECT }], error: null });
  state.signUpload.mockReset().mockResolvedValue({ data: { signedUrl: "https://storage.test/upload?token=t" }, error: null });
  state.download.mockReset().mockResolvedValue({ data: pdf(), error: null });
  state.remove.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("createRecurringExpense", () => {
  it("stores the shares the server works out, with the date as the first date", async () => {
    const key = randomUUID();
    await expect(createRecurringExpense({ idempotencyKey: key, values: values() })).rejects.toThrow(
      `REDIRECT:/recurring/${RECURRING}?saved=created`,
    );
    const [name, args] = state.rpc.mock.calls[0] ?? [];
    expect(name).toBe("create_recurring_expense");
    expect(args).toMatchObject({
      p_idempotency_key: key,
      p_group_id: GROUP,
      p_description: "Rent",
      p_amount: 2000000,
      p_start_date: today,
      p_frequency: "monthly",
      p_timezone: TIME_ZONE,
      p_participants: [
        { user_id: ME, amount: 1000000 },
        { user_id: BINA, amount: 1000000 },
      ],
      p_ledger_entries: [{ debtor_id: BINA, creditor_id: ME, amount: 1000000 }],
    });
    expect(args).not.toHaveProperty("p_expense_date");
    expect(args).not.toHaveProperty("p_end_date");
  });

  it("passes an end date when there is one", async () => {
    const endDate = addDays(today, 90);
    await expect(
      createRecurringExpense({ idempotencyKey: randomUUID(), values: values({ repeat: { frequency: "weekly", endDate, timezone: TIME_ZONE } }) }),
    ).rejects.toThrow("REDIRECT:");
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_frequency: "weekly", p_end_date: endDate });
  });

  it("refuses a first date more than 31 days back before calling the database", async () => {
    const result = await createRecurringExpense({ idempotencyKey: randomUUID(), values: values({ date: addDays(today, -32) }) });
    expect(result).toEqual({
      ok: false,
      error: "The first date must be within the last 31 days or the next year.",
      fieldErrors: { date: "The first date must be within the last 31 days or the next year." },
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("needs a real frequency", async () => {
    const result = await createRecurringExpense({
      idempotencyKey: randomUUID(),
      values: values({ repeat: { frequency: "never", endDate: "", timezone: TIME_ZONE } }),
    });
    expect(result).toMatchObject({ ok: false });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("shows the database's own message when it refuses", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "SM403", message: "You are not a member of this group" } });
    const result = await createRecurringExpense({ idempotencyKey: randomUUID(), values: values() });
    expect(result).toEqual({ ok: false, error: "You are not a member of this group.", code: "SM403" });
  });
});

describe("updateRecurringExpense", () => {
  it("says when nothing changed", async () => {
    state.rpc.mockResolvedValue({ data: 4, error: null });
    await expect(
      updateRecurringExpense({ recurringId: RECURRING, expectedVersion: 4, values: values({ date: addDays(today, -400) }) }),
    ).rejects.toThrow(`REDIRECT:/recurring/${RECURRING}?saved=unchanged`);
    // An old first date is fine on an edit; the database checks it only if it changed.
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_recurring_id: RECURRING, p_expected_version: 4 });
  });

  it("reports a saved change", async () => {
    state.rpc.mockResolvedValue({ data: 5, error: null });
    await expect(updateRecurringExpense({ recurringId: RECURRING, expectedVersion: 4, values: values() })).rejects.toThrow(
      `REDIRECT:/recurring/${RECURRING}?saved=updated`,
    );
  });
});

describe("setRecurringStatus", () => {
  it("pauses, resumes and cancels", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await setRecurringStatus({ recurringId: RECURRING, status: "paused" })).toEqual({
      ok: true,
      message: "Paused. No expenses are added until you resume it.",
    });
    expect(state.rpc).toHaveBeenCalledWith("set_recurring_expense_status", { p_recurring_id: RECURRING, p_status: "paused" });
  });

  it("rejects unknown states without calling the database", async () => {
    expect(await setRecurringStatus({ recurringId: RECURRING, status: "ended" })).toMatchObject({ ok: false });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("prepareReceiptUpload", () => {
  it("signs an upload to a fresh path in the expense's folder", async () => {
    const result = await prepareReceiptUpload({ expenseId: EXPENSE, type: "image/webp", size: 1000 });
    expect(result.ok).toBe(true);
    const path = (result as { data: { path: string } }).data.path;
    expect(path).toMatch(new RegExp(`^${EXPENSE}/[0-9a-f-]{36}\\.webp$`));
    expect(state.signUpload).toHaveBeenCalledWith(path);
  });

  it("refuses an 11th receipt, files over 5 MB and people who can't add one", async () => {
    state.count.mockResolvedValueOnce({ count: 10, error: null });
    expect(await prepareReceiptUpload({ expenseId: EXPENSE, type: "application/pdf", size: 1000 })).toEqual({
      ok: false,
      error: "An expense can have at most 10 receipts.",
    });
    expect(await prepareReceiptUpload({ expenseId: EXPENSE, type: "application/pdf", size: 5 * 1024 * 1024 + 1 })).toMatchObject({
      ok: false,
    });
    state.signUpload.mockResolvedValueOnce({ data: null, error: { message: "new row violates row-level security policy" } });
    expect(await prepareReceiptUpload({ expenseId: EXPENSE, type: "application/pdf", size: 1000 })).toEqual({
      ok: false,
      error: "You can't add receipts to this expense.",
    });
  });
});

describe("attachReceipt", () => {
  it("records the file's real type, size and a clean name", async () => {
    const result = await attachReceipt({ expenseId: EXPENSE, path: OBJECT, fileName: "C:\\scans\\Dinner bill.PDF" });
    expect(result).toEqual({ ok: true, message: "Receipt added." });
    expect(state.insert).toHaveBeenCalledWith({
      expense_id: EXPENSE,
      uploaded_by: ME,
      storage_path: OBJECT,
      mime_type: "application/pdf",
      size_bytes: pdf().size,
      file_name: "Dinner bill.pdf",
    });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("deletes an upload whose content isn't a receipt type", async () => {
    state.download.mockResolvedValue({ data: new Blob(["<html><script>"], { type: "image/png" }), error: null });
    expect(await attachReceipt({ expenseId: EXPENSE, path: OBJECT, fileName: "x.png" })).toEqual({
      ok: false,
      error: "Choose a JPEG, PNG, WebP or PDF file.",
    });
    expect(state.remove).toHaveBeenCalledWith([OBJECT]);
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("deletes an upload served with a type that isn't its real one", async () => {
    state.download.mockResolvedValue({ data: new Blob(["%PDF-1.7"], { type: "image/png" }), error: null });
    expect(await attachReceipt({ expenseId: EXPENSE, path: OBJECT, fileName: "x.png" })).toMatchObject({ ok: false });
    expect(state.remove).toHaveBeenCalledWith([OBJECT]);
  });

  it("deletes the upload when the database refuses the row", async () => {
    state.insert.mockResolvedValue({ error: { code: "SM422", message: "An expense can have at most 10 receipts" } });
    expect(await attachReceipt({ expenseId: EXPENSE, path: OBJECT, fileName: "x.pdf" })).toEqual({
      ok: false,
      error: "An expense can have at most 10 receipts.",
      code: "SM422",
    });
    expect(state.remove).toHaveBeenCalledWith([OBJECT]);
  });

  it("only takes paths in the expense's own folder", async () => {
    const other = `${GROUP}/77777777-7777-4777-8777-777777777777.pdf`;
    expect(await attachReceipt({ expenseId: EXPENSE, path: other, fileName: "x.pdf" })).toMatchObject({ ok: false });
    expect(await attachReceipt({ expenseId: EXPENSE, path: `${EXPENSE}/../x.pdf`, fileName: "x.pdf" })).toMatchObject({
      ok: false,
    });
    expect(state.download).not.toHaveBeenCalled();
  });
});

describe("deleteReceipt", () => {
  it("removes the row, then the file", async () => {
    expect(await deleteReceipt({ attachmentId: RECURRING })).toEqual({ ok: true, message: "Receipt removed." });
    expect(state.remove).toHaveBeenCalledWith([OBJECT]);
  });

  it("does nothing when no row of yours matched", async () => {
    state.deleted.mockResolvedValue({ data: [], error: null });
    expect(await deleteReceipt({ attachmentId: RECURRING })).toEqual({ ok: false, error: "Couldn't remove that receipt." });
    expect(state.remove).not.toHaveBeenCalled();
  });
});
