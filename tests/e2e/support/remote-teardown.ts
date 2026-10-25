import { E2E_EMAIL, IS_REMOTE, remoteAdmin } from "./target";

/**
 * After a remote (staging) run, removes the auth users the run created. Their
 * profiles are anonymized by the database trigger, as account deletion does;
 * the test groups and expenses stay as "Deleted user" history. Only
 * `e2e-…@example.com` accounts created in the last day are touched.
 */
export default async function remoteTeardown() {
  if (!IS_REMOTE) return;
  const admin = remoteAdmin();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      if (!user.email || !E2E_EMAIL.test(user.email) || Date.parse(user.created_at) < since) continue;
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (!deleteError) removed += 1;
    }
    if (data.users.length < 200) break;
  }
  console.log(`Removed ${removed} E2E accounts from staging.`);
}
