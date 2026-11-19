import { sessionIdentity } from "@convex-dev/auth/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

const password = "Cedar meadow! lanterns 493";
type Test = ReturnType<typeof setupRestaurantTest>;

async function createUser(t: Test, username: string) {
  const result = await t.mutation(api.auth.signUpWithUsernamePassword, { username, password });
  if (result.status !== "complete") throw new Error(JSON.stringify(result));
  return { result, caller: t.withIdentity(sessionIdentity(result.tokens)) };
}

afterEach(() => vi.unstubAllEnvs());

describe("Convex Auth without email", () => {
  it("does not expose a profile to signed-out or forged-session callers", async () => {
    const t = setupRestaurantTest();
    expect(await t.query(api.users.current)).toBeNull();
    expect(await t.withIdentity({ subject: "not-a-real-session" }).query(api.users.current)).toBeNull();
  });

  it("creates an authenticated account immediately without any email configuration", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SENDER_EMAIL", "");
    const t = setupRestaurantTest();
    // No email or Resend components are registered: sending mail would fail this test.
    const { result, caller } = await createUser(t, "immediate@example.com");
    expect((await caller.query(api.users.current))?._id).toBe(result.tokens.userId);
    expect(await caller.query(api.restaurants.current)).toBeNull();
    expect(await caller.query(api.auth.isAuthenticated)).toBe(true);
  });

  it("signs back in with a case-insensitive login identifier and the same password", async () => {
    const t = setupRestaurantTest();
    const { result } = await createUser(t, "Mariana@example.com");
    const login = await t.mutation(api.auth.signInWithUsernamePassword, {
      username: "mariana@EXAMPLE.COM", password,
    });
    if (login.status !== "complete") throw new Error(JSON.stringify(login));
    expect(login.tokens.userId).toBe(result.tokens.userId);
    expect((await t.withIdentity(sessionIdentity(login.tokens)).query(api.users.current))?._id)
      .toBe(result.tokens.userId);
  });

  it("rejects duplicate identifiers without creating another profile", async () => {
    const t = setupRestaurantTest();
    await createUser(t, "owner@example.com");
    const duplicate = await t.mutation(api.auth.signUpWithUsernamePassword, {
      username: "OWNER@example.com", password,
    });
    expect(duplicate).toMatchObject({ status: "error", userError: { error: "USERNAME_TAKEN" } });
    expect(await t.run(async (ctx) => ctx.db.query("users").take(2))).toHaveLength(1);
  });

  it("rejects invalid passwords and identifiers without creating profiles", async () => {
    const t = setupRestaurantTest();
    for (const [username, candidate, code] of [
      ["short@example.com", "short", "PASSWORD_TOO_SHORT"],
      ["", password, "USERNAME_TOO_SHORT"],
      ["a".repeat(101), password, "USERNAME_TOO_LONG"],
      ["bad\u200b@example.com", password, "USERNAME_HAS_INVALID_CHARACTERS"],
    ]) {
      const result = await t.mutation(api.auth.signUpWithUsernamePassword, { username, password: candidate });
      expect(result).toMatchObject({ status: "error", userError: { error: code } });
    }
    expect(await t.run(async (ctx) => ctx.db.query("users").take(1))).toEqual([]);
  });

  it("rejects incorrect passwords and unknown accounts", async () => {
    const t = setupRestaurantTest();
    await createUser(t, "password-check@example.com");
    const wrong = await t.mutation(api.auth.signInWithUsernamePassword, {
      username: "password-check@example.com", password: "An entirely different password! 983",
    });
    expect(wrong).toMatchObject({ status: "error", userError: { error: "INVALID_CREDENTIALS" } });
    const unknown = await t.mutation(api.auth.signInWithUsernamePassword, {
      username: "unknown@example.com", password,
    });
    expect(unknown).toMatchObject({ status: "error", userError: { error: "USER_NOT_FOUND" } });
    expect(await t.query(api.users.current)).toBeNull();
  });

  it("isolates two users and revokes access after sign-out", async () => {
    const t = setupRestaurantTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const aliceProfile = await alice.caller.query(api.users.current);
    const bobProfile = await bob.caller.query(api.users.current);
    expect(aliceProfile?._id).toBe(alice.result.tokens.userId);
    expect(bobProfile?._id).toBe(bob.result.tokens.userId);
    expect(aliceProfile?._id).not.toBe(bobProfile?._id);
    await t.mutation(api.auth.signOut, { refreshToken: alice.result.tokens.refreshToken });
    expect(await alice.caller.query(api.users.current)).toBeNull();
    expect((await bob.caller.query(api.users.current))?._id).toBe(bobProfile?._id);
  });
});
