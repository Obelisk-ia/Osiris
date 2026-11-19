import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

afterEach(() => vi.unstubAllEnvs());

describe("restaurant registration and workspace permissions", () => {
  it("refuses signed-out registration and code reads", async () => {
    const t = setupRestaurantTest();
    await expect(t.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "owner", displayName: "Visitor", restaurantName: "No access" },
    })).rejects.toThrow(/Inicia sesión/);
    await expect(t.query(api.restaurants.ownerCode)).rejects.toThrow(/Inicia sesión/);
    await expect(t.query(api.workspaces.snapshot, { workspace: "administracion" })).rejects.toThrow(/Inicia sesión/);
  });

  it("atomically creates the restaurant, first location, owner and join code once", async () => {
    const t = setupRestaurantTest();
    const { owner, registration, code } = await createRestaurant(t);
    expect(code).toMatch(/^OSR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(registration.restaurant.currencyCode).toBe("MXN");
    expect(registration.location.serviceMode).toBe("mixed");
    expect(registration.staff.roles).toEqual(["owner"]);
    const retried = await owner.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "owner", displayName: "Duplicate", restaurantName: "Duplicate" },
    });
    expect(retried).toEqual({ success: true, staffId: registration.staff._id });
    expect(await t.run(async (ctx) => ctx.db.query("organizations").take(2))).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("organizationCodes").take(2))).toHaveLength(1);
    expect(await owner.query(api.restaurants.ownerCode)).toBe(code);
  });

  it("joins immediately with several selected roles and exposes only the matching workspaces", async () => {
    const t = setupRestaurantTest();
    const { code, registration } = await createRestaurant(t);
    const member = await authenticatedCaller(t, "staff@example.com");
    expect(await member.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Paola", code: code.toLowerCase().replaceAll("-", " "), roles: ["waiter", "chef", "cashier"] },
    })).toMatchObject({ success: true });
    const joined = await member.query(api.restaurants.current);
    expect(joined?.restaurant._id).toBe(registration.restaurant._id);
    expect(joined?.staff.roles).toEqual(["cashier", "chef", "waiter"]);
    expect(joined?.staff.isActive).toBe(true);
    for (const workspace of ["mesas", "cocina", "caja", "buffet"] as const) {
      expect((await member.query(api.workspaces.snapshot, { workspace })).restaurantName).toBe("Casa Jacaranda");
    }
    await expect(member.query(api.workspaces.snapshot, { workspace: "administracion" })).rejects.toThrow(/permiso/);
    await expect(member.query(api.restaurants.ownerCode)).rejects.toThrow(/permiso/);
    await expect(member.mutation(api.restaurants.rotateCode)).rejects.toThrow(/permiso/);
    // Repeating onboarding is not a way to add privileges.
    await member.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "owner", displayName: "Paola", restaurantName: "Escalation" },
    });
    expect((await member.query(api.restaurants.current))?.staff.roles).toEqual(["cashier", "chef", "waiter"]);
  });

  it("rejects owner/manager roles submitted through a forged staff request", async () => {
    const t = setupRestaurantTest();
    const { code } = await createRestaurant(t);
    const member = await authenticatedCaller(t, "forged-role@example.com");
    for (const role of ["owner", "manager"]) {
      await expect(member.mutation(api.restaurants.completeRegistration, {
        registration: { kind: "staff", displayName: "Member", code, roles: [role] },
      } as never)).rejects.toThrow();
    }
    expect(await member.query(api.restaurants.current)).toBeNull();
    await expect(member.query(api.restaurants.ownerCode)).rejects.toThrow(/permiso/);
  });

  it("requires at least one operational role and deduplicates role selections", async () => {
    const t = setupRestaurantTest();
    const { code } = await createRestaurant(t);
    const member = await authenticatedCaller(t, "roles@example.com");
    expect(await member.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Member", code, roles: [] },
    })).toMatchObject({ success: false });
    expect(await member.query(api.restaurants.current)).toBeNull();
    await member.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Member", code, roles: ["waiter", "waiter"] },
    });
    expect((await member.query(api.restaurants.current))?.staff.roles).toEqual(["waiter"]);
    await expect(member.query(api.workspaces.snapshot, { workspace: "caja" })).rejects.toThrow(/permiso/);
    await expect(member.query(api.workspaces.snapshot, { workspace: "cocina" })).rejects.toThrow(/permiso/);
  });

  it("commits invalid-code attempts so repeatedly failing cannot bypass rate limits", async () => {
    const t = setupRestaurantTest();
    const { code } = await createRestaurant(t);
    const member = await authenticatedCaller(t, "rate-limit@example.com");
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await member.mutation(api.restaurants.completeRegistration, {
        registration: { kind: "staff", displayName: "Member", code: "INVALID", roles: ["waiter"] },
      })).toMatchObject({ success: false, message: expect.stringContaining("no es válido") });
    }
    expect(await member.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Member", code, roles: ["waiter"] },
    })).toMatchObject({ success: false, message: expect.stringContaining("Demasiados intentos") });
    expect(await member.query(api.restaurants.current)).toBeNull();
  });

  it("rotates join codes without removing existing staff", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);
    const existing = await authenticatedCaller(t, "existing@example.com");
    await existing.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Existing", code, roles: ["barista", "bartender"] },
    });
    const newCode = await owner.mutation(api.restaurants.rotateCode);
    expect(newCode).not.toBe(code);
    const newcomer = await authenticatedCaller(t, "newcomer@example.com");
    expect(await newcomer.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Newcomer", code, roles: ["cashier"] },
    })).toMatchObject({ success: false });
    expect(await newcomer.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Newcomer", code: newCode, roles: ["cashier"] },
    })).toMatchObject({ success: true });
    expect((await existing.query(api.restaurants.current))?.staff.isActive).toBe(true);
  });

  it("prevents inactive staff from using views or re-registering to restore access", async () => {
    const t = setupRestaurantTest();
    const { owner, registration, code } = await createRestaurant(t);
    await t.run(async (ctx) => ctx.db.patch("staff", registration.staff._id, { isActive: false }));
    await expect(owner.query(api.workspaces.snapshot, { workspace: "mesas" })).rejects.toThrow(/permiso/);
    await expect(owner.query(api.restaurants.ownerCode)).rejects.toThrow(/permiso/);
    await owner.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Retry", code, roles: ["cashier"] },
    });
    expect((await owner.query(api.restaurants.current))?.staff.isActive).toBe(false);
  });

  it("scopes workspace records to the current restaurant", async () => {
    const t = setupRestaurantTest();
    const alice = await createRestaurant(t, "alice-owner@example.com");
    const bob = await createRestaurant(t, "bob-owner@example.com");
    await t.run(async (ctx) => ctx.db.patch("staff", bob.registration.staff._id, { displayName: "Private Bob" }));
    const snapshot = await alice.owner.query(api.workspaces.snapshot, { workspace: "administracion" });
    expect(snapshot.items.map((item) => item.title)).toEqual(["Mariana"]);
    expect(snapshot.items.some((item) => item.title === "Private Bob")).toBe(false);
  });
});
