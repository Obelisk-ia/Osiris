import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api, internal } from "./_generated/api";

afterEach(() => vi.unstubAllEnvs());
const UNIT = 1_000_000;

async function fixture(stock = 100 * UNIT) {
  const t = setupRestaurantTest();
  const { owner, registration, code } = await createRestaurant(t);
  const scope = { organizationId: registration.restaurant._id, locationId: registration.location._id };
  const records = await t.run(async (ctx) => {
    const inventoryItemId = await ctx.db.insert("inventoryItems", {
      organizationId: scope.organizationId, name: "Harina", unit: "g", isActive: true,
    });
    const balanceId = await ctx.db.insert("inventoryBalances", {
      ...scope, inventoryItemId, quantityMicros: stock, updatedAt: Date.now(),
    });
    const dishId = await ctx.db.insert("dishes", {
      organizationId: scope.organizationId, name: "Pan", priceCents: 2500, isAvailable: true,
    });
    await ctx.db.insert("recipeIngredients", { organizationId: scope.organizationId, dishId, inventoryItemId, quantityMicros: 10 * UNIT });
    const stationId = await ctx.db.insert("preparationStations", { ...scope, name: "Cocina", role: "chef", isActive: true });
    const accountId = await ctx.db.insert("accounts", {
      ...scope, openedByStaffId: registration.staff._id, kind: "takeaway", state: "open",
      folio: 1, version: 1, requestId: "fixture-account", totalCents: 5000, updatedAt: Date.now(),
    });
    // Takeaway orders work without a dining table.
    const orderId = await ctx.db.insert("orders", { ...scope, accountId, status: "ordered", takenByStaffId: registration.staff._id, updatedAt: Date.now() });
    const itemId = await ctx.db.insert("orderItems", {
      ...scope, orderId, dishId, quantity: 2, dishName: "Pan", unitPriceCents: 2500, status: "ordered", updatedAt: Date.now(),
    });
    const preparationId = await ctx.db.insert("orderItemPreparations", {
      ...scope, orderItemId: itemId, stationId, status: "ordered", updatedAt: Date.now(),
    });
    const menuId = await ctx.db.insert("buffetMenus", { ...scope, name: "Desayuno", menuDate: "2026-11-17", isActive: true });
    await ctx.db.insert("buffetMenuDishes", { ...scope, buffetMenuId: menuId, dishId, sortOrder: 0 });
    const batchId = await ctx.db.insert("buffetBatches", {
      ...scope, buffetMenuId: menuId, dishId, stationId, portions: 3, status: "ordered", updatedAt: Date.now(),
    });
    return { inventoryItemId, balanceId, dishId, stationId, accountId, orderId, itemId, preparationId, menuId, batchId };
  });
  return { t, owner, registration, code, scope, ...records };
}

describe("preparation-time inventory consumption", () => {
  it("consumes once when preparation starts, including retries and a second station", async () => {
    const f = await fixture();
    const second = await f.t.run(async (ctx) => {
      const stationId = await ctx.db.insert("preparationStations", { ...f.scope, name: "Otra estación", role: "chef", isActive: true });
      return await ctx.db.insert("orderItemPreparations", { ...f.scope, orderItemId: f.itemId, stationId, status: "ordered", updatedAt: Date.now() });
    });
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(100 * UNIT);
    await f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId });
    await f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId });
    await f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: second });
    const state = await f.t.run(async (ctx) => ({
      balance: await ctx.db.get("inventoryBalances", f.balanceId),
      item: await ctx.db.get("orderItems", f.itemId),
      movements: await ctx.db.query("inventoryMovements").withIndex("by_locationId_and_inventoryItemId", (q) =>
        q.eq("locationId", f.scope.locationId).eq("inventoryItemId", f.inventoryItemId)).take(5),
    }));
    expect(state.balance?.quantityMicros).toBe(80 * UNIT);
    expect(state.item?.status).toBe("preparing");
    expect(state.item?.inventoryConsumedAt).toBeDefined();
    expect(state.movements).toHaveLength(1);
    expect(state.movements[0].quantityDeltaMicros).toBe(-20 * UNIT);
  });

  it("rolls back all ingredients and status updates when any ingredient is insufficient", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const itemId = await ctx.db.insert("inventoryItems", { organizationId: f.scope.organizationId, name: "Sal", unit: "g", isActive: true });
      await ctx.db.insert("recipeIngredients", { organizationId: f.scope.organizationId, dishId: f.dishId, inventoryItemId: itemId, quantityMicros: UNIT });
      await ctx.db.insert("inventoryBalances", { ...f.scope, inventoryItemId: itemId, quantityMicros: 0, updatedAt: Date.now() });
    });
    await expect(f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId })).rejects.toThrow(/insuficiente/);
    const state = await f.t.run(async (ctx) => ({
      balance: await ctx.db.get("inventoryBalances", f.balanceId),
      preparation: await ctx.db.get("orderItemPreparations", f.preparationId),
      item: await ctx.db.get("orderItems", f.itemId),
      movements: await ctx.db.query("inventoryMovements")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", f.scope.locationId)).take(5),
    }));
    expect(state.balance?.quantityMicros).toBe(100 * UNIT);
    expect(state.preparation?.status).toBe("ordered");
    expect(state.item?.inventoryConsumedAt).toBeUndefined();
    expect(state.movements).toHaveLength(0);
  });

  it("refuses waiters and staff from another restaurant", async () => {
    const f = await fixture();
    const waiter = await authenticatedCaller(f.t, "waiter@example.com");
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Waiter", code: f.code, roles: ["waiter"] },
    });
    await expect(waiter.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId })).rejects.toThrow(/permiso/);
    const outsider = await createRestaurant(f.t, "outsider@example.com");
    await expect(outsider.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId })).rejects.toThrow(/permiso/);
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(100 * UNIT);
  });

  it("checks the specific chef/barista/bartender station role, not just kitchen access", async () => {
    const f = await fixture();
    const barista = await authenticatedCaller(f.t, "barista@example.com");
    await barista.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Barista", code: f.code, roles: ["barista", "bartender"] },
    });
    await expect(barista.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId })).rejects.toThrow(/permiso/);
    const baristaPreparation = await f.t.run(async (ctx) => {
      const stationId = await ctx.db.insert("preparationStations", { ...f.scope, name: "Café", role: "barista", isActive: true });
      return ctx.db.insert("orderItemPreparations", { ...f.scope, orderItemId: f.itemId, stationId, status: "ordered", updatedAt: Date.now() });
    });
    const view = await barista.query(api.workspaces.snapshot, { workspace: "cocina" });
    expect(view.items.map((item) => item.id)).toEqual([baristaPreparation]);
    await barista.mutation(internal.preparation.startOrderPreparation, { preparationId: baristaPreparation });
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(80 * UNIT);
  });

  it("consumes the snapshotted modifier recipe, including ingredient removals", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => ctx.db.insert("orderItemModifiers", {
      ...f.scope, orderItemId: f.itemId, dishId: f.dishId,
      groupName: "Receta", optionName: "Menos harina", quantity: 1, unitPriceExtraCents: 0,
      recipeDeltas: [{ inventoryItemId: f.inventoryItemId, quantityDeltaMicros: -2 * UNIT }],
    }));
    await f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId });
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(84 * UNIT);
  });

  it("deducts buffet stock by prepared batch portions exactly once", async () => {
    const f = await fixture();
    await f.owner.mutation(internal.preparation.startBuffetBatch, { batchId: f.batchId });
    await f.owner.mutation(internal.preparation.startBuffetBatch, { batchId: f.batchId });
    const state = await f.t.run(async (ctx) => ({
      balance: await ctx.db.get("inventoryBalances", f.balanceId), batch: await ctx.db.get("buffetBatches", f.batchId),
      movements: await ctx.db.query("inventoryMovements")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", f.scope.locationId)).take(5),
    }));
    expect(state.balance?.quantityMicros).toBe(70 * UNIT);
    expect(state.batch?.status).toBe("preparing");
    expect(state.movements).toHaveLength(1);
    expect(state.movements[0].recipePortions).toBe(3);
  });

  it("rejects buffet preparation without enough stock or for an inactive menu", async () => {
    const f = await fixture(20 * UNIT);
    await expect(f.owner.mutation(internal.preparation.startBuffetBatch, { batchId: f.batchId })).rejects.toThrow(/insuficiente/);
    expect((await f.t.run(async (ctx) => ctx.db.get("buffetBatches", f.batchId)))?.status).toBe("ordered");
    await f.t.run(async (ctx) => ctx.db.patch("buffetMenus", f.menuId, { isActive: false }));
    await expect(f.owner.mutation(internal.preparation.startBuffetBatch, { batchId: f.batchId })).rejects.toThrow(/no está disponible/);
  });

  it("rejects fractional or unsafe inventory arithmetic and closed accounts", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => ctx.db.patch("buffetBatches", f.batchId, { portions: 0.5 }));
    await expect(f.owner.mutation(internal.preparation.startBuffetBatch, { batchId: f.batchId })).rejects.toThrow(/cantidad válida/);
    await f.t.run(async (ctx) => ctx.db.patch("accounts", f.accountId, { state: "closed", closedAt: Date.now() }));
    await expect(f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId })).rejects.toThrow(/terminó/);
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(100 * UNIT);
  });

  it("rejects unsafe integer multiplication without touching stock", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => ctx.db.patch("buffetBatches", f.batchId, { portions: Number.MAX_SAFE_INTEGER }));
    await expect(f.owner.mutation(internal.preparation.startBuffetBatch, { batchId: f.batchId })).rejects.toThrow(/cantidad inválida/);
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(100 * UNIT);
  });

  it("rejects fractional modifier micro-units even when multiplication would yield an integer", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => ctx.db.insert("orderItemModifiers", {
      ...f.scope, orderItemId: f.itemId, dishId: f.dishId, groupName: "Test",
      optionName: "Invalid precision", quantity: 1, unitPriceExtraCents: 0,
      recipeDeltas: [{ inventoryItemId: f.inventoryItemId, quantityDeltaMicros: 0.5 }],
    }));
    await expect(f.owner.mutation(internal.preparation.startOrderPreparation, { preparationId: f.preparationId })).rejects.toThrow(/cantidad inválida/);
    expect((await f.t.run(async (ctx) => ctx.db.get("inventoryBalances", f.balanceId)))?.quantityMicros).toBe(100 * UNIT);
  });
});
