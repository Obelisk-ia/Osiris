/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

describe("public QR diner menu, call waiter, and delivery-gated requestBill", () => {
  it("shows live menu & unlocks Pedir la cuenta ONLY after all plates are delivered", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const waiter = await authenticatedCaller(t, "waiter-qr@example.com");
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });
    const cashier = await authenticatedCaller(t, "cashier-qr@example.com");
    await cashier.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Sofía", code, roles: ["cashier"] },
    });
    const chef = await authenticatedCaller(t, "chef-qr@example.com");
    await chef.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Marco", code, roles: ["chef"] },
    });

    const waiterStaffId = (await waiter.query(api.restaurants.current))!.staff._id;
    const sectionId = await owner.mutation(api.floor.createSection, {
      name: "Terraza",
      canvas: { x: 1, y: 1, width: 60, height: 30 },
      assignedStaffId: waiterStaffId,
    });
    const tableId = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 7",
      x: 30,
      y: 50,
    });

    const catId = await owner.mutation(api.menu.createCategory, { name: "Platillos" });
    const dishId = await owner.mutation(api.menu.createDish, {
      name: "Enchiladas suizas",
      description: "Con salsa verde cremosa.",
      priceCents: 16500,
      categoryId: catId,
      isAvailable: true,
      isPublished: true,
      areas: ["kitchen"],
      modifierGroupIds: [],
      recipe: [],
    });

    const floorSnap = await owner.query(api.floor.snapshot);
    const table = floorSnap.tables.find((tb) => tb._id === tableId)!;
    const qrToken = table.qrToken;

    // Public unauthenticated query sees live menu & empty table
    const initial = await t.query(api.diner.tableByQrToken, { qrToken });
    expect(initial.status).toBe("ready");
    if (initial.status !== "ready") throw new Error("Expected ready");
    expect(initial.table.tableNumber).toBe("Mesa 7");
    expect(initial.dishes).toHaveLength(1);
    expect(initial.account).toBeNull();

    // Public read-only menu by locationId works too
    const pubMenu = await t.query(api.diner.publicMenu, { locationId: initial.locationId });
    expect(pubMenu.status).toBe("ready");
    if (pubMenu.status !== "ready") throw new Error("Expected ready");
    expect(pubMenu.dishes[0].name).toBe("Enchiladas suizas");

    // Calling waiter on empty table notifies assigned waiter and respects cooldown
    const call1 = await t.mutation(api.diner.callWaiter, { qrToken, guestName: "Ana" });
    expect(call1).toEqual({ notified: true, cooldown: false });
    const call2 = await t.mutation(api.diner.callWaiter, { qrToken, guestName: "Ana" });
    expect(call2).toEqual({ notified: false, cooldown: true });

    const waiterNotifsAfterCall = await waiter.query(api.notifications.list);
    expect(waiterNotifsAfterCall.items.some((n) => n.title.includes("Mesa 7 te está llamando"))).toBe(true);

    // Cannot request bill when table has no account yet
    await expect(t.mutation(api.diner.requestBill, { qrToken })).rejects.toThrow(/cuenta abierta/);

    // Waiter takes order for 2 plates -> Pedir la cuenta MUST STAY LOCKED while undelivered!
    const order = await waiter.mutation(api.waiter.submitOrder, {
      tableId,
      items: [{ dishId, quantity: 2, modifierOptionIds: [] }],
    });

    const whilePreparing = await t.query(api.diner.tableByQrToken, { qrToken });
    if (whilePreparing.status !== "ready" || !whilePreparing.account) throw new Error("Expected account");
    expect(whilePreparing.account.canRequestBill).toBe(false);
    expect(whilePreparing.account.hasUndelivered).toBe(true);
    expect(whilePreparing.account.billLockReason).toContain("faltan 2");
    await expect(t.mutation(api.diner.requestBill, { qrToken })).rejects.toThrow(/faltan 2/);

    // Kitchen marks 1 of 2 ready, waiter delivers 1 of 2 -> STILL LOCKED (1 remaining!)
    const kitchenSnap = await chef.query(api.kitchen.snapshot);
    const preparationId = kitchenSnap.tickets[0].items[0].preparationId;
    await chef.mutation(api.kitchen.startItemUnits, { preparationId, quantity: 2 });
    await chef.mutation(api.kitchen.markItemReadyUnits, { preparationId, quantity: 1 });
    await waiter.mutation(api.waiter.deliverReadyItems, { accountId: order.accountId });

    const partial = await t.query(api.diner.tableByQrToken, { qrToken });
    if (partial.status !== "ready" || !partial.account) throw new Error("Expected account");
    expect(partial.account.deliveredUnits).toBe(1);
    expect(partial.account.totalUnits).toBe(2);
    expect(partial.account.canRequestBill).toBe(false);
    await expect(t.mutation(api.diner.requestBill, { qrToken })).rejects.toThrow(/último platillo/);

    // Kitchen marks 2nd plate ready & waiter delivers it -> NOW UNLOCKED!
    await chef.mutation(api.kitchen.markItemReadyUnits, { preparationId, quantity: 1 });
    await waiter.mutation(api.waiter.deliverReadyItems, { accountId: order.accountId });

    const unlocked = await t.query(api.diner.tableByQrToken, { qrToken });
    if (unlocked.status !== "ready" || !unlocked.account) throw new Error("Expected account");
    expect(unlocked.account.deliveredUnits).toBe(2);
    expect(unlocked.account.hasUndelivered).toBe(false);
    expect(unlocked.account.canRequestBill).toBe(true);
    expect(unlocked.account.billLockReason).toBeNull();

    // Guest requests the bill from QR -> flips table to payment, appears in Caja, notifies Waiter & Caja!
    const billRes = await t.mutation(api.diner.requestBill, { qrToken });
    expect(billRes.totalCents).toBe(33000);

    const floorAfterBill = await owner.query(api.floor.snapshot);
    expect(floorAfterBill.tables.find((tb) => tb._id === tableId)?.status).toBe("payment");

    const cajaSnap = await cashier.query(api.cashier.snapshot);
    expect(cajaSnap.readyAccounts).toHaveLength(1);
    expect(cajaSnap.readyAccounts[0].label).toBe("Mesa 7");

    const cashierNotifs = await cashier.query(api.notifications.list);
    expect(cashierNotifs.items.some((n) => n.title.includes("Mesa 7 pidió la cuenta (QR)"))).toBe(true);

    // Pausing & regenerating QR immediately revokes old token
    await owner.mutation(api.floor.setTableQrEnabled, { tableId, enabled: false });
    const pausedView = await t.query(api.diner.tableByQrToken, { qrToken });
    expect(pausedView.status).toBe("paused");

    await owner.mutation(api.floor.setTableQrEnabled, { tableId, enabled: true });
    await owner.mutation(api.floor.regenerateTableQr, { tableId });
    const oldTokenView = await t.query(api.diner.tableByQrToken, { qrToken });
    expect(oldTokenView.status).toBe("invalid");
  });
});
