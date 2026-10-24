import { spawn } from "node:child_process";

/**
 * Runs SQL in its own psql session on the LOCAL database container, as the
 * given user (role `authenticated` with their JWT claims), and resolves when
 * the session ends. For concurrency tests that need a second, slow transaction
 * next to the Data API calls. Local only: integration tests refuse other URLs.
 */
export function psqlAs(userId: string, sql: string): Promise<{ code: number | null; output: string }> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const script = `begin;
set local role authenticated;
select set_config('request.jwt.claims', '${claims}', true);
${sql}
commit;
`;
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_splitmate", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(script);
  });
}
