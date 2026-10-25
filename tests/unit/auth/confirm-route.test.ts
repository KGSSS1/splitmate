// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/auth/confirm/route";
import { confirmEmailLink } from "@/server/actions/auth";

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("server-only", () => ({}));
// The "where to go after onboarding" cookie set at sign-up (src/server/after-auth.ts).
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

async function landing(query: string): Promise<string> {
  try {
    await GET(new NextRequest(`http://localhost:3100/auth/confirm?${query}`));
  } catch (error) {
    return String((error as Error).message).replace("REDIRECT:", "");
  }
  throw new Error("expected a redirect");
}

/** Pressing Continue on /auth/continue (the form posts token_hash and type). */
async function pressContinue(fields: Record<string, string>): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  try {
    await confirmEmailLink(form);
  } catch (error) {
    return String((error as Error).message).replace("REDIRECT:", "");
  }
  throw new Error("expected a redirect");
}

const TOKEN = "pkce_0123456789abcdef";

describe("/auth/confirm", () => {
  beforeEach(() => {
    auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
    auth.exchangeCodeForSession.mockReset();
    jar.clear();
  });

  describe("token_hash links (custom templates)", () => {
    // Review M9 L3: opening the link uses nothing; Continue (a POST) verifies.
    it("forwards to the Continue page without using the token", async () => {
      expect(await landing(`token_hash=${TOKEN}&type=email`)).toBe(`/auth/continue?token_hash=${TOKEN}&type=email`);
      expect(await landing(`token_hash=${TOKEN}&type=recovery`)).toBe(`/auth/continue?token_hash=${TOKEN}&type=recovery`);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("rejects malformed links and unknown types up front", async () => {
      expect(await landing("token_hash=abc&type=email")).toBe("/login?error=link");
      expect(await landing(`token_hash=${TOKEN}&type=magiclink`)).toBe("/login?error=link");
      expect(await landing(`token_hash=${TOKEN}`)).toBe("/login?error=link");
      expect(await landing(`token_hash=${encodeURIComponent("x/../evil")}&type=email`)).toBe("/login?error=link");
    });

    it("Continue confirms sign-up and goes to onboarding", async () => {
      expect(await pressContinue({ token_hash: TOKEN, type: "email" })).toBe("/onboarding");
      expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: TOKEN });
    });

    it("Continue on a password reset goes to the new-password page", async () => {
      expect(await pressContinue({ token_hash: TOKEN, type: "recovery" })).toBe("/reset-password/update");
    });

    it("Continue rejects invalid or used tokens, and forged form fields", async () => {
      auth.verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
      expect(await pressContinue({ token_hash: TOKEN, type: "email" })).toBe("/login?error=link");
      auth.verifyOtp.mockClear();
      expect(await pressContinue({ token_hash: TOKEN, type: "invite" })).toBe("/login?error=link");
      expect(await pressContinue({})).toBe("/login?error=link");
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });
  });

  describe("?code= links (default ConfirmationURL templates)", () => {
    it("exchanges a sign-up code and goes to onboarding", async () => {
      auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null });
      expect(await landing("code=c-123")).toBe("/onboarding");
      expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("c-123", undefined);
    });

    it("exchanges a recovery code and goes to the new-password page", async () => {
      auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: "recovery" }, error: null });
      expect(await landing("code=c-123")).toBe("/reset-password/update");
    });

    it("passes the PKCE flow id through when present", async () => {
      auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null });
      await landing("code=c-123&sb_flow_id=flow_abcdefgh");
      expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("c-123", { flowId: "flow_abcdefgh" });
    });

    it("explains links opened in a different browser", async () => {
      auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "pkce_code_verifier_not_found" } });
      expect(await landing("code=c-123")).toBe("/login?error=browser");
    });

    it("rejects used or invalid codes", async () => {
      auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "flow_state_not_found" } });
      expect(await landing("code=c-123")).toBe("/login?error=link");
    });
  });

  describe("a destination remembered at sign-up", () => {
    it("is carried to onboarding once, then forgotten", async () => {
      jar.set("splitmate-next", "/invite/tok?group=g1");
      expect(await pressContinue({ token_hash: TOKEN, type: "email" })).toBe("/onboarding?next=%2Finvite%2Ftok%3Fgroup%3Dg1");
      expect(jar.has("splitmate-next")).toBe(false);
      expect(await pressContinue({ token_hash: TOKEN, type: "email" })).toBe("/onboarding");
    });

    it("also applies to ?code= links", async () => {
      jar.set("splitmate-next", "/groups/g1");
      auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null });
      expect(await landing("code=c-123")).toBe("/onboarding?next=%2Fgroups%2Fg1");
    });

    it("is ignored when it is not a safe path", async () => {
      jar.set("splitmate-next", "https://evil.example");
      expect(await pressContinue({ token_hash: TOKEN, type: "email" })).toBe("/onboarding");
    });

    it("never redirects a password reset", async () => {
      jar.set("splitmate-next", "/groups/g1");
      expect(await pressContinue({ token_hash: TOKEN, type: "recovery" })).toBe("/reset-password/update");
    });
  });

  it("turns auth-server errors and empty links into the invalid-link message", async () => {
    expect(await landing("error=access_denied&error_code=otp_expired")).toBe("/login?error=link");
    expect(await landing("")).toBe("/login?error=link");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
