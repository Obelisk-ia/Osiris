/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

describe("waiter tables, shared menu ordering, and owner floor sync", () => {
  it("shows waiter their assigned tables plus unassigned tables, hiding other waiters' sections", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const waiterA = await authenticatedCaller(t, "waiter-a@example.com");
    await waiterA.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });
    const waiterB = await authenticatedCaller(t, "waiter-b@example.com");
    await waiterB.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Paola", code, roles: ["waiter"] },
    });

    const staffA = (await waiterA.query(api.restaurants.current))!.staff._id;
    const staffB = (await waiterB.query(api.restaurants.current))!.staff._id;

    const secA = await owner.mutation(api.floor.createSection, {
      name: "Salón",
      canvas: { x: 1, y: 1, width: 45, height: 28 },
      assignedStaffId: staffA,
    });
    const secB = await owner.mutation(api.floor.createSection, {
      name: "Terraza",
      canvas: { x: 50, y: 1, width: 45, height: 28 },
      assignedStaffId: staffB,
    });
    const secFree = await owner.mutation(api.floor.createSection, {
      name: "Barra",
      canvas: { x: 1, y: 32, width: 94, height: 20 },
    });

    await owner.mutation(api.floor.createTable, { sectionId: secA, tableNumber: "Mesa 1", x: 30, y: 50 });
    await owner.mutation(api.floor.createTable, { sectionId: secB, tableNumber: "Mesa 2", x: 30, y: 50 });
    await owner.mutation(api.floor.createTable, { sectionId: secFree, tableNumber: "Barra 1", x: 30, y: 50 });

    const snapA = await waiterA.query(api.waiter.tablesSnapshot);
    expect(snapA.freeTables.map((tb) => tb.tableNumber)).toEqual(["Barra 1", "Mesa 1"]);

    const snapB = await waiterB.query(api.waiter.tablesSnapshot);
    expect(snapB.freeTables.map((tb) => tb.tableNumber)).toEqual(["Barra 1", "Mesa 2"]);
  });

  it("takes an order from the shared menu, updates owner floor status in real time, and progresses to bill", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const waiter = await authenticatedCaller(t, "waiter-order@example.com");
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });

    const sectionId = await owner.mutation(api.floor.createSection, {
      name: "Salón",
      canvas: { x: 1, y: 1, width: 60, height: 30 },
    });
    const table1 = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 1",
      x: 25,
      y: 50,
    });
    const table2 = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 2",
      x: 65,
      y: 50,
    });

    // Owner creates menu with required modifier and multi-area dish (kitchen + bar)
    const modGroupId = await owner.mutation(api.menu.createModifierGroup, {
      name: "Salsa",
      required: true,
      multi: false,
      options: [
        { name: "Soya dulce", priceExtraCents: 1500 },
        { name: "Sin salsa", priceExtraCents: 0 },
      ],
    });
    const dishId = await owner.mutation(api.menu.createDish, {
      name: "Rollo dragón",
      description: "Preparado en barra y cocina.",
      priceCents: 18500,
      areas: ["kitchen", "bar"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [modGroupId],
      recipe: [],
    });

    // Waiter opens workspace for free table -> sees shared menu
    const wsBefore = await waiter.query(api.waiter.orderWorkspace, { tableId: table1 });
    expect(wsBefore.account).toBeNull();
    expect(wsBefore.dishes).toHaveLength(1);
    const modOptionId = wsBefore.modifierGroups[0].options[0]._id;

    // Missing required modifier is rejected
    await expect(
      waiter.mutation(api.waiter.submitOrder, {
        tableId: table1,
        items: [{ dishId, quantity: 2, modifierOptionIds: [] }],
      }),
    ).rejects.toThrow(/obligatoria/);

    // Submit valid order
    const submitted = await waiter.mutation(api.waiter.submitOrder, {
      tableId: table1,
      items: [{ dishId, quantity: 2, comments: "Sin ajonjolí", modifierOptionIds: [modOptionId] }],
    });
    expect(submitted.stationNames.sort()).toEqual(["Barra", "Cocina"]);

    // Owner floor plan immediately reflects Mesa 1 as occupied!
    let floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === table1)?.status).toBe("occupied");
    expect(floorSnap.tables.find((tb) => tb._id === table2)?.status).toBe("empty");

    // Waiter's Mis mesas shows Mesa 1 with progressStep 0 (Enviado) & total = 2 * (18500 + 1500) = 40000
    let waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables).toHaveLength(1);
    expect(waiterSnap.busyTables[0]).toMatchObject({
      tableId: table1,
      status: "occupied",
      progressStep: 0,
      totalCents: 40000,
    });
    expect(waiterSnap.busyTables[0].areaSummaries).toHaveLength(2);

    // Mark delivered -> progressStep becomes 3 (Entregado)
    await waiter.mutation(api.waiter.markAccountDelivered, { accountId: submitted.accountId });
    waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].progressStep).toBe(3);
    expect(waiterSnap.busyTables[0].hasUndelivered).toBe(false);

    // Request bill -> owner floor plan flips to payment (Quieren pagar)
    await waiter.mutation(api.waiter.requestBill, { accountId: submitted.accountId });
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === table1)?.status).toBe("payment");

    // Reopen for ordering -> flips back to occupied
    await waiter.mutation(api.waiter.reopenForOrdering, { accountId: submitted.accountId });
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === table1)?.status).toBe("occupied");

    // Move account from Mesa 1 to Mesa 2
    await waiter.mutation(api.waiter.moveAccountToTable, {
      accountId: submitted.accountId,
      targetTableId: table2,
    });
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === table1)?.status).toBe("empty");
    expect(floorSnap.tables.find((tb) => tb._id === table2)?.status).toBe("occupied");
  });

  it("supports takeout accounts and enforces role/waiter ownership boundaries", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const waiter = await authenticatedCaller(t, "waiter-takeout@example.com");
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });
    const chef = await authenticatedCaller(t, "chef-only@example.com");
    await chef.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Rosa", code, roles: ["chef"] },
    });

    await expect(chef.query(api.waiter.tablesSnapshot)).rejects.toThrow(/permiso/);

    const dishId = await owner.mutation(api.menu.createDish, {
      name: "Tacos al pastor",
      priceCents: 14500,
      areas: ["kitchen"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [],
    });

    const accId = await waiter.mutation(api.waiter.createTakeoutAccount, {
      kind: "takeaway",
      customerName: "Andrea Solís",
      customerPhone: "5512345678",
      phoneConsent: true,
    });
    await waiter.mutation(api.waiter.submitOrder, {
      accountId: accId,
      items: [{ dishId, quantity: 3, modifierOptionIds: [] }],
    });

    const snap = await waiter.query(api.waiter.takeoutSnapshot);
    expect(snap.accounts).toHaveLength(1);
    expect(snap.accounts[0]).toMatchObject({
      customerName: "Andrea Solís",
      stage: "nuevo",
      totalCents: 43500,
    });
  });
});
