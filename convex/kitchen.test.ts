/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

const UNIT = 1_000_000;

describe("station-split preparation, shared dishes, negative inventory, and partial delivery", () => {
  it("routes each dish strictly to its assigned station roles and enforces role boundaries", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const [waiter, chef, barStaff, bartender, barista] = await Promise.all([
      authenticatedCaller(t, "waiter-k@example.com"),
      authenticatedCaller(t, "chef-k@example.com"),
      authenticatedCaller(t, "bar-k@example.com"),
      authenticatedCaller(t, "bartender-k@example.com"),
      authenticatedCaller(t, "barista-k@example.com"),
    ]);

    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });
    await chef.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Rosa", code, roles: ["chef"] },
    });
    await barStaff.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Mateo", code, roles: ["bar"] },
    });
    await bartender.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Diego", code, roles: ["bartender"] },
    });
    await barista.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Sofía", code, roles: ["barista"] },
    });

    // Waiter cannot open kitchen board
    await expect(waiter.query(api.kitchen.snapshot)).rejects.toThrow(/permiso/);

    const sectionId = await owner.mutation(api.floor.createSection, {
      name: "Salón",
      canvas: { x: 1, y: 1, width: 60, height: 30 },
    });
    const tableId = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 1",
      x: 30,
      y: 50,
    });

    // Create salmon with only 50g in stock so recipe (150g) goes negative cleanly.
    const { itemId: salmonId } = await owner.mutation(api.inventory.createItem, {
      name: "Salmón fresco",
      unit: "g",
      category: "Proteínas",
      presentation: "kilogramo",
      factorMicros: 1000 * UNIT,
      initialMicros: 50 * UNIT,
      minMicros: 20 * UNIT,
    });

    const sushiId = await owner.mutation(api.menu.createDish, {
      name: "Rollo dragón",
      description: "Compartido entre barra y cocina.",
      priceCents: 19000,
      areas: ["kitchen", "bar"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [{ inventoryItemId: salmonId, quantityMicros: 150 * UNIT }],
    });
    const cocktailId = await owner.mutation(api.menu.createDish, {
      name: "Margarita",
      priceCents: 13500,
      areas: ["cocktails"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [],
    });
    const coffeeId = await owner.mutation(api.menu.createDish, {
      name: "Espresso",
      priceCents: 6500,
      areas: ["coffee"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [],
    });

    const order = await waiter.mutation(api.waiter.submitOrder, {
      tableId,
      items: [
        { dishId: sushiId, quantity: 1, comments: "Sin picante", modifierOptionIds: [] },
        { dishId: cocktailId, quantity: 2, modifierOptionIds: [] },
        { dishId: coffeeId, quantity: 1, modifierOptionIds: [] },
      ],
    });
    expect(order.stationNames.sort()).toEqual(["Barra", "Cafetería", "Cocina", "Coctelería"]);

    // Verify strict 1-to-1 isolation across all 4 station roles
    const [chefSnap, barSnap, bartenderSnap, baristaSnap] = await Promise.all([
      chef.query(api.kitchen.snapshot),
      barStaff.query(api.kitchen.snapshot),
      bartender.query(api.kitchen.snapshot),
      barista.query(api.kitchen.snapshot),
    ]);

    expect(chefSnap.tickets).toHaveLength(1);
    expect(chefSnap.tickets[0].area).toBe("kitchen");
    expect(chefSnap.tickets[0].items.map((i) => i.dishName)).toEqual(["Rollo dragón"]);
    expect(chefSnap.tickets[0].items[0].otherStations.map((s) => s.stationName)).toEqual(["Barra"]);

    expect(barSnap.tickets).toHaveLength(1);
    expect(barSnap.tickets[0].area).toBe("bar");
    expect(barSnap.tickets[0].items.map((i) => i.dishName)).toEqual(["Rollo dragón"]);
    expect(barSnap.tickets[0].items[0].otherStations.map((s) => s.stationName)).toEqual(["Cocina"]);

    expect(bartenderSnap.tickets).toHaveLength(1);
    expect(bartenderSnap.tickets[0].area).toBe("cocktails");
    expect(bartenderSnap.tickets[0].items.map((i) => i.dishName)).toEqual(["Margarita"]);

    expect(baristaSnap.tickets).toHaveLength(1);
    expect(baristaSnap.tickets[0].area).toBe("coffee");
    expect(baristaSnap.tickets[0].items.map((i) => i.dishName)).toEqual(["Espresso"]);

    const kitchenStationId = chefSnap.tickets[0].stationId;
    const barStationId = barSnap.tickets[0].stationId;
    const cocktailStationId = bartenderSnap.tickets[0].stationId;
    const coffeeStationId = baristaSnap.tickets[0].stationId;

    // Cross-station mutation must be refused (bartender cannot start Barra or Cocina)
    await expect(
      bartender.mutation(api.kitchen.startTicket, { orderId: order.orderId, stationId: barStationId }),
    ).rejects.toThrow(/permiso/);
    await expect(
      bartender.mutation(api.kitchen.startTicket, { orderId: order.orderId, stationId: kitchenStationId }),
    ).rejects.toThrow(/permiso/);

    // 1) Barra starts preparing -> salmon goes negative (-100g), consumed ONCE
    await barStaff.mutation(api.kitchen.startTicket, { orderId: order.orderId, stationId: barStationId });
    let invSnap = await owner.query(api.inventory.snapshot);
    const salmonAfterBar = invSnap.items.find((i) => i._id === salmonId);
    expect(salmonAfterBar?.stockMicros).toBe(-100 * UNIT);
    expect(salmonAfterBar?.status).toBe("negative");

    // Chef starts preparing same shared dish -> salmon NOT deducted a second time
    await chef.mutation(api.kitchen.startTicket, { orderId: order.orderId, stationId: kitchenStationId });
    invSnap = await owner.query(api.inventory.snapshot);
    expect(invSnap.items.find((i) => i._id === salmonId)?.stockMicros).toBe(-100 * UNIT);

    // 2) Barra finishes Rollo dragón while Cocina is STILL preparing -> NOT deliverable yet!
    await barStaff.mutation(api.kitchen.markTicketReady, { orderId: order.orderId, stationId: barStationId });
    let waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].status).toBe("occupied");
    const barSection = waiterSnap.busyTables[0].stationSections.find((s) => s.stationId === barStationId)!;
    expect(barSection.deliverableCount).toBe(0);
    expect(barSection.waitingOnOtherCount).toBe(1);
    expect(barSection.waitingStationNames).toEqual(["Cocina"]);

    await expect(
      waiter.mutation(api.waiter.deliverStationItems, { accountId: order.accountId, stationId: barStationId }),
    ).rejects.toThrow(/compartidos/);

    // Owner floor plan stays "occupied" (shared dish not ready across both stations yet)
    let floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("occupied");

    // 3) Bartender prepares & marks Coctelería ready -> table flips to "attended" (Pedido listo)
    await bartender.mutation(api.kitchen.startTicket, { orderId: order.orderId, stationId: cocktailStationId });
    await bartender.mutation(api.kitchen.markTicketReady, { orderId: order.orderId, stationId: cocktailStationId });

    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("attended");
    waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].status).toBe("ready");

    // Waiter delivers ONLY Coctelería -> table becomes "partial" (Entrega parcial)!
    const partialDelivery = await waiter.mutation(api.waiter.deliverStationItems, {
      accountId: order.accountId,
      stationId: cocktailStationId,
    });
    expect(partialDelivery.deliveredCount).toBe(1);
    expect(partialDelivery.tableStatus).toBe("partial");

    // Both Owner floor plan and Waiter tables reflect "partial" (Entrega parcial)
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("partial");
    waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].status).toBe("partial");
    expect(
      waiterSnap.busyTables[0].stationSections.find((s) => s.stationId === cocktailStationId)?.status,
    ).toBe("delivered");

    // Delivered cocktail disappears from bartender's board immediately
    expect((await bartender.query(api.kitchen.snapshot)).tickets).toHaveLength(0);

    // 4) Chef marks Cocina ready -> NOW Rollo dragón is ready across BOTH Barra & Cocina!
    await chef.mutation(api.kitchen.markTicketReady, { orderId: order.orderId, stationId: kitchenStationId });
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("attended");

    // Waiter delivers shared dish -> disappears from BOTH Cocina AND Barra boards;
    // Espresso is still pending, so table returns to "partial"!
    await waiter.mutation(api.waiter.deliverStationItems, {
      accountId: order.accountId,
      stationId: kitchenStationId,
    });
    expect((await chef.query(api.kitchen.snapshot)).tickets).toHaveLength(0);
    expect((await barStaff.query(api.kitchen.snapshot)).tickets).toHaveLength(0);
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("partial");

    // 5) Barista finishes Cafetería and waiter delivers -> all items delivered -> "occupied"
    await barista.mutation(api.kitchen.startTicket, { orderId: order.orderId, stationId: coffeeStationId });
    await barista.mutation(api.kitchen.markTicketReady, { orderId: order.orderId, stationId: coffeeStationId });
    await waiter.mutation(api.waiter.deliverStationItems, {
      accountId: order.accountId,
      stationId: coffeeStationId,
    });

    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("occupied");
    waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].status).toBe("occupied");
    expect(waiterSnap.busyTables[0].hasUndelivered).toBe(false);

    // 6) Request bill -> "payment", then owner/caja confirms payment -> table resets to "empty" (Libre)!
    await waiter.mutation(api.waiter.requestBill, { accountId: order.accountId });
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("payment");

    const paid = await owner.mutation(api.waiter.confirmPayment, { accountId: order.accountId });
    expect(paid.totalCents).toBe(19000 + 2 * 13500 + 6500);
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("empty");
    waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables).toHaveLength(0);
    expect(waiterSnap.freeTables.map((tb) => tb.tableId)).toEqual([tableId]);
  });

  it("supports partial-quantity prep (e.g. 3 of 5 plates), shared-dish min sync, and plate-level delivery", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const [waiter, chef, barStaff] = await Promise.all([
      authenticatedCaller(t, "waiter-qty@example.com"),
      authenticatedCaller(t, "chef-qty@example.com"),
      authenticatedCaller(t, "bar-qty@example.com"),
    ]);
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });
    await chef.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Rosa", code, roles: ["chef"] },
    });
    await barStaff.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Mateo", code, roles: ["bar"] },
    });

    const sectionId = await owner.mutation(api.floor.createSection, {
      name: "Salón",
      canvas: { x: 1, y: 1, width: 60, height: 30 },
    });
    const tableId = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 5",
      x: 30,
      y: 50,
    });
    const { itemId: riceId } = await owner.mutation(api.inventory.createItem, {
      name: "Arroz",
      unit: "g",
      category: "Secos",
      presentation: "kilogramo",
      factorMicros: 1000 * UNIT,
      initialMicros: 400 * UNIT,
      minMicros: 50 * UNIT,
    });
    const sushiId = await owner.mutation(api.menu.createDish, {
      name: "Rollo dragón",
      priceCents: 18000,
      areas: ["kitchen", "bar"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [{ inventoryItemId: riceId, quantityMicros: 100 * UNIT }],
    });

    const order = await waiter.mutation(api.waiter.submitOrder, {
      tableId,
      items: [{ dishId: sushiId, quantity: 5, modifierOptionIds: [] }],
    });

    const chefPrepId = (await chef.query(api.kitchen.snapshot)).tickets[0].items[0].preparationId;
    const barPrepId = (await barStaff.query(api.kitchen.snapshot)).tickets[0].items[0].preparationId;

    // Barra starts 3 of 5 -> consumes 3 * 100g = 300g (400 -> 100g)
    await barStaff.mutation(api.kitchen.startItemUnits, { preparationId: barPrepId, quantity: 3 });
    expect((await owner.query(api.inventory.snapshot)).items[0].stockMicros).toBe(100 * UNIT);

    // Cocina starts 2 of 5 -> already consumed 3, so stock stays 100g!
    await chef.mutation(api.kitchen.startItemUnits, { preparationId: chefPrepId, quantity: 2 });
    expect((await owner.query(api.inventory.snapshot)).items[0].stockMicros).toBe(100 * UNIT);

    // Barra starts remaining 2 (total 5) -> consumes delta 2 * 100g = 200g (100 -> -100g negative!)
    await barStaff.mutation(api.kitchen.startItemUnits, { preparationId: barPrepId, quantity: 2 });
    expect((await owner.query(api.inventory.snapshot)).items[0].stockMicros).toBe(-100 * UNIT);

    // Barra marks 4 of 5 ready; Cocina marks 2 of 5 ready -> shared dish has min(4, 2) = 2 deliverable!
    await barStaff.mutation(api.kitchen.markItemReadyUnits, { preparationId: barPrepId, quantity: 4 });
    await chef.mutation(api.kitchen.markItemReadyUnits, { preparationId: chefPrepId, quantity: 2 });

    let waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].deliveredUnits).toBe(0);
    expect(waiterSnap.busyTables[0].totalUnits).toBe(5);
    expect(waiterSnap.busyTables[0].plates).toHaveLength(1);
    const plate = waiterSnap.busyTables[0].plates[0];
    expect(plate).toMatchObject({
      dishName: "Rollo dragón",
      quantity: 5,
      stationLabel: "Cocina + Barra",
      effectiveReadyQuantity: 2,
      deliveredQuantity: 0,
      deliverableQuantity: 2,
      preparingQuantity: 3,
      pendingQuantity: 0,
      status: "ready",
    });

    // Owner floor shows "attended" (Pedido listo) because 2 complete plates are ready
    let floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("attended");

    // Waiter delivers those 2 ready plates -> table flips to "partial" (Entrega parcial)!
    const firstDrop = await waiter.mutation(api.waiter.deliverOrderItem, {
      orderItemId: plate.orderItemId,
      quantity: 2,
    });
    expect(firstDrop).toEqual({ deliveredUnits: 2, tableStatus: "partial" });

    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("partial");
    waiterSnap = await waiter.query(api.waiter.tablesSnapshot);
    expect(waiterSnap.busyTables[0].status).toBe("partial");
    expect(waiterSnap.busyTables[0].plates[0]).toMatchObject({
      deliveredQuantity: 2,
      deliverableQuantity: 0,
      status: "preparing",
    });

    // Cannot deliver more yet (Barra has 4 ready, Cocina only 2 ready -> waiting on Cocina)
    await expect(
      waiter.mutation(api.waiter.deliverOrderItem, { orderItemId: plate.orderItemId }),
    ).rejects.toThrow(/espera/);

    // Cocina starts & finishes remaining 3, Barra finishes remaining 1 -> 3 more plates deliverable!
    await chef.mutation(api.kitchen.startItemUnits, { preparationId: chefPrepId, quantity: 3 });
    await chef.mutation(api.kitchen.markItemReadyUnits, { preparationId: chefPrepId, quantity: 3 });
    await barStaff.mutation(api.kitchen.markItemReadyUnits, { preparationId: barPrepId, quantity: 1 });

    // Stock stayed at -100g (total 5 portions consumed across both stations)
    expect((await owner.query(api.inventory.snapshot)).items[0].stockMicros).toBe(-100 * UNIT);

    // Waiter delivers remaining 3 plates -> all 5 delivered -> "occupied" & kitchen boards clear!
    const finalDrop = await waiter.mutation(api.waiter.deliverOrderItem, {
      orderItemId: plate.orderItemId,
    });
    expect(finalDrop).toEqual({ deliveredUnits: 3, tableStatus: "occupied" });
    expect((await chef.query(api.kitchen.snapshot)).tickets).toHaveLength(0);
    expect((await barStaff.query(api.kitchen.snapshot)).tickets).toHaveLength(0);

    // Owner/caja confirms payment -> table resets to "empty"
    await owner.mutation(api.waiter.confirmPayment, { accountId: order.accountId });
    floorSnap = await owner.query(api.floor.snapshot);
    expect(floorSnap.tables.find((tb) => tb._id === tableId)?.status).toBe("empty");
  });

  it("supports cancelling sent dishes with inventory reconciliation, NO PREPARAR kitchen notice, waiter reassignment, avisos, and paid takeout history", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const [waiterA, waiterB, chef] = await Promise.all([
      authenticatedCaller(t, "waiter-c1@example.com"),
      authenticatedCaller(t, "waiter-c2@example.com"),
      authenticatedCaller(t, "chef-c1@example.com"),
    ]);
    await waiterA.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
    });
    await waiterB.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Paola", code, roles: ["waiter"] },
    });
    await chef.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Rosa", code, roles: ["chef"] },
    });

    const staffBId = (await waiterB.query(api.restaurants.current))!.staff._id;
    const sectionId = await owner.mutation(api.floor.createSection, {
      name: "Salón",
      canvas: { x: 1, y: 1, width: 60, height: 30 },
    });
    const tableId = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 9",
      x: 30,
      y: 50,
    });
    const { itemId: beefId } = await owner.mutation(api.inventory.createItem, {
      name: "Arrachera",
      unit: "g",
      category: "Proteínas",
      presentation: "kilogramo",
      factorMicros: 1000 * UNIT,
      initialMicros: 500 * UNIT,
      minMicros: 100 * UNIT,
    });
    const steakId = await owner.mutation(api.menu.createDish, {
      name: "Tacos de arrachera",
      priceCents: 22000,
      areas: ["kitchen"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [{ inventoryItemId: beefId, quantityMicros: 200 * UNIT }],
    });
    const soupId = await owner.mutation(api.menu.createDish, {
      name: "Sopa azteca",
      priceCents: 11000,
      areas: ["kitchen"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [],
    });

    const order = await waiterA.mutation(api.waiter.submitOrder, {
      tableId,
      items: [
        { dishId: steakId, quantity: 1, modifierOptionIds: [] },
        { dishId: soupId, quantity: 1, modifierOptionIds: [] },
      ],
    });

    // Chef receives "Pedido nuevo" Aviso notification
    let chefNotifs = await chef.query(api.notifications.list);
    expect(chefNotifs.unreadCount).toBe(1);
    expect(chefNotifs.items[0].kind).toBe("order");

    // Chef starts preparing -> consumes 200g arrachera (500g -> 300g)
    const kitchenTicket = (await chef.query(api.kitchen.snapshot)).tickets[0];
    await chef.mutation(api.kitchen.startTicket, {
      orderId: order.orderId,
      stationId: kitchenTicket.stationId,
    });
    expect((await owner.query(api.inventory.snapshot)).items[0].stockMicros).toBe(300 * UNIT);

    // Waiter cancels Tacos de arrachera returning ingredients -> stock restored to 500g!
    const steakOrderItem = kitchenTicket.items.find((i) => i.dishName === "Tacos de arrachera")!;
    const cancelRes = await waiterA.mutation(api.waiter.cancelOrderItem, {
      orderItemId: steakOrderItem.orderItemId,
      reason: "Cliente cambió de platillo",
      inventoryAction: "return",
    });
    expect(cancelRes).toEqual({ inventoryAction: "return", notifiedKitchen: true });
    expect((await owner.query(api.inventory.snapshot)).items[0].stockMicros).toBe(500 * UNIT);

    // Account total drops to only Sopa azteca (11000)
    const wsAfterCancel = await waiterA.query(api.waiter.orderWorkspace, { accountId: order.accountId });
    expect(wsAfterCancel.account?.totalCents).toBe(11000);
    expect(wsAfterCancel.account?.plates.map((p) => p.dishName)).toEqual(["Sopa azteca"]);

    // Kitchen sees Tacos de arrachera crossed out (isCancelled: true) + received cancel Aviso!
    let chefSnap = await chef.query(api.kitchen.snapshot);
    expect(chefSnap.tickets[0].hasUnackedCancelled).toBe(true);
    expect(chefSnap.tickets[0].items.find((i) => i.dishName === "Tacos de arrachera")?.isCancelled).toBe(true);
    chefNotifs = await chef.query(api.notifications.list);
    expect(chefNotifs.items.some((n) => n.kind === "cancel" && n.title.includes("No preparar"))).toBe(true);

    // Chef acknowledges cancellation -> cancelled line dismissed, Sopa azteca remains in Preparando
    await chef.mutation(api.kitchen.acknowledgeCancelledTicket, {
      orderId: order.orderId,
      stationId: kitchenTicket.stationId,
    });
    chefSnap = await chef.query(api.kitchen.snapshot);
    expect(chefSnap.tickets[0].hasUnackedCancelled).toBe(false);
    expect(chefSnap.tickets[0].items.map((i) => i.dishName)).toEqual(["Sopa azteca"]);

    // Reassign table from Javier (waiterA) to Paola (waiterB)
    const reassigned = await waiterA.mutation(api.waiter.reassignAccountWaiter, {
      accountId: order.accountId,
      targetStaffId: staffBId,
    });
    expect(reassigned.assignedStaffName).toBe("Paola");
    const waiterBNotifs = await waiterB.query(api.notifications.list);
    expect(waiterBNotifs.unreadCount).toBe(1);
    expect(waiterBNotifs.items[0].kind).toBe("reassign");
    await waiterB.mutation(api.notifications.markAllRead);
    expect((await waiterB.query(api.notifications.list)).unreadCount).toBe(0);

    // Chef marks Sopa azteca ready -> Paola (the newly assigned waiter!) gets the "ready" Aviso
    await chef.mutation(api.kitchen.markTicketReady, {
      orderId: order.orderId,
      stationId: kitchenTicket.stationId,
    });
    const paolaAfterReady = await waiterB.query(api.notifications.list);
    expect(paolaAfterReady.unreadCount).toBe(1);
    expect(paolaAfterReady.items[0].kind).toBe("ready");

    // Takeout order paid today stays visible in Entregado column with isPaid: true
    const takeoutId = await waiterA.mutation(api.waiter.createTakeoutAccount, {
      kind: "takeaway",
      customerName: "Carlos Ruiz",
      promisedAt: Date.now() + 20 * 60_000,
    });
    await waiterA.mutation(api.waiter.submitOrder, {
      accountId: takeoutId,
      items: [{ dishId: soupId, quantity: 1, modifierOptionIds: [] }],
    });
    await owner.mutation(api.waiter.confirmPayment, { accountId: takeoutId });
    const takeoutSnap = await waiterA.query(api.waiter.takeoutSnapshot);
    const paidTakeout = takeoutSnap.accounts.find((a) => a._id === takeoutId);
    expect(paidTakeout).toMatchObject({
      customerName: "Carlos Ruiz",
      stage: "entregado",
      isPaid: true,
    });
  });
});
