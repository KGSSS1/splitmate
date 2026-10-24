import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUsers,
  signedInClient,
  type TestUser,
} from "./support/supabase";

// Auth settings from supabase/config.toml plus the profiles trigger, RLS and
// column grants from the M2 migrations, exercised through the real API.
describe("auth and profiles against local Supabase", () => {
  const admin = adminClient();
  const users: TestUser[] = [];
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await createTestUser(admin, { displayName: "  Alice Example  " });
    bob = await createTestUser(admin);
    users.push(alice, bob);
  });

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("refuses to log in until the email is confirmed", async () => {
    const unconfirmed = await createTestUser(admin, { confirmed: false });
    users.push(unconfirmed);

    const { error } = await anonClient().auth.signInWithPassword({
      email: unconfirmed.email,
      password: unconfirmed.password,
    });
    expect(error?.code).toBe("email_not_confirmed");
  });

  it("rejects passwords shorter than 8 characters at sign-up", async () => {
    const { error } = await anonClient().auth.signUp({ email: "short-pw@example.com", password: "1234567" });
    expect(error?.code).toBe("weak_password");
  });

  it("creates a profile on sign-up that needs onboarding", async () => {
    const client = await signedInClient(alice);
    const { data, error } = await client
      .from("profiles")
      .select("id, email, display_name, default_currency, timezone, onboarded_at")
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: alice.id,
      email: alice.email.toLowerCase(),
      display_name: "Alice Example",
      default_currency: "INR",
      timezone: "Asia/Kolkata",
      onboarded_at: null,
    });
  });

  it("lets users complete onboarding on their own profile", async () => {
    const client = await signedInClient(alice);
    const onboardedAt = new Date().toISOString();
    const { data, error } = await client
      .from("profiles")
      .update({ display_name: "Alice", default_currency: "JPY", timezone: "Asia/Tokyo", onboarded_at: onboardedAt })
      .eq("id", alice.id)
      .select("display_name, default_currency, timezone, onboarded_at");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ display_name: "Alice", default_currency: "JPY", timezone: "Asia/Tokyo" });
    expect(data?.[0]?.onboarded_at).not.toBeNull();
  });

  it("shows and updates only the user's own profile", async () => {
    const client = await signedInClient(alice);

    const { data: visible } = await client.from("profiles").select("id");
    expect(visible?.map((row) => row.id)).toEqual([alice.id]);

    const { data: updated, error } = await client
      .from("profiles")
      .update({ display_name: "Hijacked" })
      .eq("id", bob.id)
      .select("id");
    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: bobProfile } = await admin.from("profiles").select("display_name").eq("id", bob.id).single();
    expect(bobProfile?.display_name).not.toBe("Hijacked");
  });

  it("does not let users change their email or deletion state directly", async () => {
    const client = await signedInClient(alice);
    const { error } = await client
      .from("profiles")
      .update({ email: "someone-else@example.com" })
      .eq("id", alice.id);
    expect(error?.code).toBe("42501");

    const { error: deletedError } = await client
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", alice.id);
    expect(deletedError?.code).toBe("42501");
  });

  it("rejects unsupported currencies and blank names", async () => {
    const client = await signedInClient(alice);
    const { error: currencyError } = await client
      .from("profiles")
      .update({ default_currency: "XYZ" })
      .eq("id", alice.id);
    // Review L37: the check constraint itself refuses it, not some other error.
    expect(currencyError).toMatchObject({ code: "23514", message: expect.stringContaining("currency_code_supported") });

    const { error: nameError } = await client.from("profiles").update({ display_name: "   " }).eq("id", alice.id);
    expect(nameError).toMatchObject({ code: "23514", message: expect.stringContaining("profiles_display_name_check") });
  });

  it("gives signed-out visitors no profile data", async () => {
    const { data, error } = await anonClient().from("profiles").select("id");
    expect(data ?? []).toEqual([]);
    expect(error?.code ?? "42501").toBe("42501");
  });
});
