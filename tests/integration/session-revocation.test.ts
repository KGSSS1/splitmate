import { afterAll, describe, expect, it } from "vitest";

import { adminClient, anonClient, createTestUser, deleteTestUsers, type TestUser } from "./support/supabase";

// Review M6 L12: an access token stays cryptographically valid until it expires,
// so getClaims() (a local check) still accepts it after logout. getUser() asks
// Supabase Auth, which knows the session has ended. Sensitive actions rely on that.
describe("a logged-out session (review L12)", () => {
  const admin = adminClient();
  const users: TestUser[] = [];

  afterAll(async () => {
    await deleteTestUsers(admin, users);
  });

  it("is refused by getUser() although its token still verifies", async () => {
    const user = await createTestUser(admin, { displayName: "L12" });
    users.push(user);
    const client = anonClient();
    const { data: signedIn, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error) throw error;
    const token = signedIn.session.access_token;

    // Before logging out, both checks pass.
    expect((await anonClient().auth.getUser(token)).data.user?.id).toBe(user.id);
    expect((await anonClient().auth.getClaims(token)).data?.claims.sub).toBe(user.id);

    const { error: signOutError } = await client.auth.signOut({ scope: "local" });
    expect(signOutError).toBeNull();

    // The token still verifies locally, but Supabase Auth says the session is gone.
    expect((await anonClient().auth.getClaims(token)).data?.claims.sub).toBe(user.id);
    const after = await anonClient().auth.getUser(token);
    expect(after.data.user).toBeNull();
    expect(after.error).not.toBeNull();
  });
});
