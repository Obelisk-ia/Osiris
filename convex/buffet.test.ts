import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { MICROS_PER_UNIT, todayIsoDate } from "../lib/format";
import type { OperationalRole } from "../lib/restaurant-roles";
import { api } from "./_generated/api";

afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = setupRestaurantTest();
  const { owner, registration, code } = await createRestaurant(t);
  const scope = { organizationId: registration.restaurant._id, locationId: registration.location._id };
  const menuDate = todayIsoDate(registration.location.timeZone);
  async function employee(role: OperationalRole, username: string = role) {
    const caller = await authenticatedCaller(t, `${username}@example.com`);
    await caller.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: username, code, roles: [role] },
    });
    return caller;
  }

  const { dishId, stockId, ingredientId } = await t.run(async (ctx) => {
    const ingredientId = await ctx.db.insert("inventoryItems", {
      organizationId: scope.organizationId, name: "Pollo", unit: "g", isActive: true,
    });
    const stockId = await ctx.db.insert("inventoryBalances", {
      ...scope, inventoryItemId: ingredientId, quantityMicros: 1_000 * MICROS_PER_UNIT, updatedAt: Date.now(),
    });
    const dishId = await ctx.db.insert("dishes", {
      organizationId: scope.organizationId, name: "Pollo asado", priceCents: 16000,
      areas: ["kitchen"], isAvailable: true,
    });
    await ctx.db.insert("recipeIngredients", {
      organizationId: scope.organizationId, inventoryItemId: ingredientId, dishId, quantityMicros: 50 * MICROS_PER_UNIT,
    });
    return { dishId, stockId, ingredientId };
  });
  const menuSettings = {
    name: "Comida", menuDate, isActive: true, dishIds: [dishId],
    dishSettings: [{ dishId, destination: "Línea caliente", portionsPerTray: 4 }],
  };
  const menuId = await owner.mutation(api.buffet.createMenu, menuSettings);
  const waiter = await employee("waiter");
  const chef = await employee("chef");
  return { t, owner, scope, dishId, stockId, ingredientId, menuDate, menuSettings, menuId, waiter, chef, employee };
}

describe("buffet replenishment", () => {
  it("seats and checks out a group without a kitchen order and retains rates when extras are added", async () => {
    const f = await fixture();
    const otherWaiter = await f.employee("waiter", "another-waiter");
    const sectionId = await f.owner.mutation(api.floor.createSection, {
      name: "Comedor", canvas: { x: 1, y: 1, width: 60, height: 30 },
    });
    const tableId = await f.owner.mutation(api.floor.createTable, { sectionId, tableNumber: "Mesa 4", x: 30, y: 50 });
    const table = (await f.owner.query(api.floor.snapshot)).tables[0];
    const args = { tableId, adults: 2, children: 1, requestId: "opening" };
    await f.owner.mutation(api.admin.updateFeatures, { serviceMode: "buffet" });
    await expect(f.waiter.mutation(api.waiter.seatBuffetParty, args)).rejects.toThrow(/tarifas/);
    await f.owner.mutation(api.admin.updateFeatures, { buffetPrices: { adultCents: 24000, childCents: 11000 } });
    await expect(f.waiter.mutation(api.waiter.seatBuffetParty, { ...args, children: 3 })).rejects.toThrow(/1 a 4/);
    await expect(f.chef.mutation(api.waiter.seatBuffetParty, args)).rejects.toThrow(/permiso/);

    const accountId = await f.waiter.mutation(api.waiter.seatBuffetParty, args);
    await expect(f.waiter.mutation(api.waiter.seatBuffetParty, args)).resolves.toBe(accountId);
    await expect(otherWaiter.mutation(api.waiter.seatBuffetParty, { ...args, requestId: "second" })).rejects.toThrow(/otro mesero|ocupada/);
    expect((await f.owner.query(api.floor.snapshot)).tables[0].status).toBe("occupied");
    expect((await f.chef.query(api.kitchen.snapshot)).tickets).toEqual([]);
    expect(await f.t.query(api.diner.tableByQrToken, { qrToken: table.qrToken })).toMatchObject({ account: {
      totalCents: 59000, items: [], canRequestBill: true,
    } });
    expect(await f.waiter.query(api.waiter.orderWorkspace, { accountId })).toMatchObject({
      canTakeOrder: false, account: { totalCents: 59000, buffetAdmission: { adults: 2, children: 1 } },
    });

    await f.owner.mutation(api.admin.updateFeatures, {
      buffetPrices: { adultCents: 28000, childCents: 15000 }, buffetTableService: false,
    });
    expect(await f.waiter.query(api.waiter.tablesSnapshot)).toMatchObject({ tableServiceEnabled: false, busyTables: [{ accountId }] });
    const extraId = await f.owner.mutation(api.menu.createDish, {
      name: "Agua de jamaica", areas: ["kitchen"], priceCents: 4500, isPublished: true,
      isAvailable: true, buffetExtra: true, modifierGroupIds: [], recipe: [],
    });
    expect(await f.waiter.query(api.waiter.orderWorkspace, { accountId })).toMatchObject({ canTakeOrder: true });
    await f.waiter.mutation(api.waiter.submitOrder, { accountId, items: [{ dishId: extraId, quantity: 1, modifierOptionIds: [] }] });
    expect((await f.waiter.query(api.waiter.orderWorkspace, { accountId })).account?.totalCents).toBe(63500);
    await f.waiter.mutation(api.waiter.requestBill, { accountId });
    expect((await f.owner.query(api.cashier.snapshot)).readyAccounts).toMatchObject([{ _id: accountId, buffetGuestCount: 3, totalCents: 63500 }]);
    await expect(f.owner.mutation(api.cashier.chargeAccount, {
      accountId, payments: [{ method: "efectivo", receivedCents: 63500 }],
    })).resolves.toMatchObject({ closed: true });
    expect((await f.owner.query(api.floor.snapshot)).tables[0].status).toBe("empty");
    expect(await f.waiter.query(api.waiter.tablesSnapshot)).toMatchObject({ tableServiceEnabled: false, busyTables: [], freeTables: [] });
    await expect(f.waiter.mutation(api.waiter.seatBuffetParty, { ...args, requestId: "disabled" })).rejects.toThrow(/no tiene activo/);

    await f.owner.mutation(api.admin.updateFeatures, { buffetTableService: true, buffetPrices: { adultCents: 24000, childCents: 0 } });
    const complimentary = await f.waiter.mutation(api.waiter.seatBuffetParty, { ...args, adults: 0, children: 1, requestId: "courtesy" });
    await f.waiter.mutation(api.waiter.requestBill, { accountId: complimentary });
    await expect(f.owner.mutation(api.cashier.chargeAccount, { accountId: complimentary, payments: [] }))
      .resolves.toMatchObject({ closed: true, paidNowCents: 0 });
  });

  it("deduplicates across staff and menus, routes to kitchen, signals ready, and consumes one tray once", async () => {
    const f = await fixture();
    const secondWaiter = await f.employee("waiter", "second-waiter");
    const bar = await f.employee("bar");
    const secondMenu = await f.owner.mutation(api.buffet.createMenu, {
      ...f.menuSettings, name: "Otro menú",
      dishSettings: [{ dishId: f.dishId, destination: "LÍNEA  CALIENTE", portionsPerTray: 4 }],
    });
    const requests = await Promise.all([
      f.waiter.mutation(api.buffet.requestReplenishment, { menuId: f.menuId, dishId: f.dishId }),
      secondWaiter.mutation(api.buffet.requestReplenishment, { menuId: secondMenu, dishId: f.dishId }),
    ]);
    const { batchId } = requests[0];
    expect(requests.map((request) => request.batchId)).toEqual([batchId, batchId]);
    expect(requests.filter((request) => request.created)).toHaveLength(1);
    const service = await secondWaiter.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate });
    expect(service.active).toHaveLength(1);
    expect(service.menus.every((menu) => menu.dishes[0].hasOpenRequest)).toBe(true);
    expect((await f.chef.query(api.kitchen.snapshot)).replenishments).toMatchObject([
      { _id: batchId, status: "ordered", portions: 4 },
    ]);
    expect((await bar.query(api.kitchen.snapshot)).replenishments).toEqual([]);
    await expect(bar.mutation(api.buffet.updateReplenishment, { batchId, status: "ready" })).rejects.toThrow(/permiso/);
    await expect(f.waiter.mutation(api.buffet.updateReplenishment, { batchId, status: "preparing" })).rejects.toThrow(/permiso/);
    await expect(f.waiter.mutation(api.buffet.updateReplenishment, { batchId, status: "delivered" })).rejects.toThrow(/estado/);

    await f.chef.mutation(api.buffet.updateReplenishment, { batchId, status: "preparing" });
    expect((await f.waiter.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate })).active[0].status).toBe("preparing");
    await f.chef.mutation(api.buffet.updateReplenishment, { batchId, status: "ready" });
    await f.chef.mutation(api.buffet.updateReplenishment, { batchId, status: "ready" });
    const requester = requests[0].created ? f.waiter : secondWaiter;
    expect((await requester.query(api.notifications.list)).items).toMatchObject([
      { kind: "ready", title: "Buffet: Pollo asado listo para llevar", href: "/cuenta/buffet" },
    ]);
    await expect(f.chef.mutation(api.buffet.updateReplenishment, { batchId, status: "delivered" })).rejects.toThrow(/permiso/);
    await secondWaiter.mutation(api.buffet.updateReplenishment, { batchId, status: "delivered" });
    await secondWaiter.mutation(api.buffet.updateReplenishment, { batchId, status: "delivered" });
    const finished = await f.waiter.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate });
    expect(finished.active).toEqual([]);
    expect(finished.recent).toMatchObject([{ _id: batchId, status: "delivered" }]);
    expect((await f.chef.query(api.kitchen.snapshot)).replenishments).toEqual([]);

    const stock = await f.t.run((ctx) => ctx.db.get("inventoryBalances", f.stockId));
    expect(stock?.quantityMicros).toBe(800 * MICROS_PER_UNIT);

    const next = await f.waiter.mutation(api.buffet.requestReplenishment, { menuId: f.menuId, dishId: f.dishId });
    expect(next.batchId).not.toBe(batchId);
    await f.chef.mutation(api.buffet.updateReplenishment, { batchId: next.batchId, status: "ready" });
    const movements = await f.t.run((ctx) => ctx.db.query("inventoryMovements")
      .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", f.scope.locationId)
        .eq("inventoryItemId", f.ingredientId)).take(5));
    expect(movements.map((row) => row.quantityDeltaMicros)).toEqual([-200 * MICROS_PER_UNIT, -200 * MICROS_PER_UNIT]);
  });

  it("keeps tickets scoped and lets the team finish a request after the menu is deactivated", async () => {
    const f = await fixture();
    const { owner: outsider } = await createRestaurant(f.t, "outsider@example.com");
    const args = { menuId: f.menuId, dishId: f.dishId };
    const { batchId } = await f.waiter.mutation(api.buffet.requestReplenishment, args);
    await expect(f.t.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate })).rejects.toThrow(/sesión/);
    await expect(outsider.mutation(api.buffet.requestReplenishment, args)).rejects.toThrow(/menú/);
    await expect(outsider.mutation(api.buffet.updateReplenishment, { batchId, status: "ready" })).rejects.toThrow(/permiso/);
    expect((await outsider.query(api.kitchen.snapshot)).replenishments).toEqual([]);
    expect(await outsider.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate })).toMatchObject({ menus: [], active: [] });

    await f.owner.mutation(api.buffet.toggleMenuActive, { menuId: f.menuId });
    await expect(f.waiter.mutation(api.buffet.requestReplenishment, args)).rejects.toThrow(/activo/);
    await f.owner.mutation(api.admin.updateFeatures, { serviceMode: "a_la_carte" });
    expect(await f.waiter.query(api.buffet.hasOpenReplenishments)).toBe(true);
    expect(await f.waiter.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate })).toMatchObject({
      enabled: false, menus: [], active: [{ _id: batchId }],
    });
    await expect(f.waiter.mutation(api.buffet.requestReplenishment, args)).rejects.toThrow(/modo Buffet o Mixto/);
    await f.chef.mutation(api.buffet.updateReplenishment, { batchId, status: "ready" });
    await f.waiter.mutation(api.buffet.updateReplenishment, { batchId, status: "delivered" });
    expect(await f.waiter.query(api.buffet.hasOpenReplenishments)).toBe(false);
    expect((await f.waiter.query(api.buffet.serviceSnapshot, { menuDate: f.menuDate })).recent).toMatchObject([
      { _id: batchId, status: "delivered" },
    ]);
  });
});
