import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { psqlAdmin } from "./support/psql";
import { adminClient } from "./support/supabase";

// Staging, 2026-10-24: an auth user deleted from the dashboard left its profile
// behind (profiles have no FK to auth.users, so history survives), and the
// profile's unique email then made every new sign-up with that address fail
// with "Database error creating new user".
describe("auth users deleted outside the app", () => {
  const admin = adminClient();
  const created: string[] = [];

  async function createUser(email: string) {
    const result = await admin.auth.admin.createUser({ email, password: `it-${randomUUID()}`, email_confirm: true });
    if (result.data.user) created.push(result.data.user.id);
    return result;
  }

  async function profile(id: string) {
    const { data, error } = await admin
      .from("profiles")
      .select("email, display_name, deleted_at")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  it("anonymizes the profile, so the same email can sign up again", async () => {
    const email = `it-${randomUUID()}@example.com`;
    const first = await createUser(email);
    expect(first.error).toBeNull();
    const firstId = first.data.user?.id ?? "";

    expect((await admin.auth.admin.deleteUser(firstId)).error).toBeNull();
    expect(await profile(firstId)).toEqual({ email: null, display_name: "Deleted user", deleted_at: expect.any(String) });

    const second = await createUser(email);
    expect(second.error).toBeNull();
    expect(await profile(second.data.user?.id ?? "")).toMatchObject({ email, deleted_at: null });
  });

  it("frees the email of a profile already left without its auth user", async () => {
    const email = `it-${randomUUID()}@example.com`;
    const orphan = randomUUID();
    // What staging had: a profile whose auth user was deleted before the fix.
    const inserted = await psqlAdmin(
      `insert into public.profiles (id, email, display_name) values ('${orphan}', '${email}', 'Orphan');`,
    );
    expect(inserted.code).toBe(0);

    const result = await createUser(email);
    expect(result.error).toBeNull();
    expect(await profile(result.data.user?.id ?? "")).toMatchObject({ email, deleted_at: null });
    expect(await profile(orphan)).toEqual({ email: null, display_name: "Deleted user", deleted_at: expect.any(String) });
  });

  it("still refuses an email that belongs to a live account", async () => {
    const email = `it-${randomUUID()}@example.com`;
    expect((await createUser(email)).error).toBeNull();
    const again = await createUser(email);
    expect(again.error).not.toBeNull();
  });
});
