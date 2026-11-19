/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

describe("owner & manager backend suite", () => {
  it("manages inventory items, merges duplicates naturally, records entries/adjustments and archives", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    const created = await owner.mutation(api.inventory.createItem, {
      name: "Salmón",
      unit: "g",
      category: "Pescados y mariscos",
      minMicros: 2_000_000_000, // 2,000 g
      presentation: "Caja de 5 kg",
      factorMicros: 5_000_000_000,
      initialMicros: 1_500_000_000, // 1,500 g -> low
    });
    expect(created.merged).toBe(false);
    const itemId = created.itemId;

    let snap = await owner.query(api.inventory.snapshot);
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({
      name: "Salmón",
      status: "low",
      stockMicros: 1_500_000_000,
      minMicros: 2_000_000_000,
    });
    expect(snap.movements).toHaveLength(1);

    // Adding "salmon" again merges into the existing "Salmón" instead of duplicating.
    const merged = await owner.mutation(api.inventory.createItem, {
      name: "  salmon  ",
      unit: "g",
      category: "Pescados y mariscos",
      minMicros: 2_000_000_000,
      presentation: "Caja de 5 kg",
      factorMicros: 5_000_000_000,
      initialMicros: 1_000_000_000,
    });
    expect(merged).toMatchObject({
      itemId,
      merged: true,
      addedMicros: 1_000_000_000,
      newStockMicros: 2_500_000_000,
      itemName: "Salmón",
    });

    // Record entry: +5,000 g -> 7,500 g (normal)
    const entry = await owner.mutation(api.inventory.recordEntry, {
      inventoryItemId: itemId,
      addedMicros: 5_000_000_000,
      costCents: 125_000,
      note: "1 × Caja de 5 kg",
    });
    expect(entry.newStockMicros).toBe(7_500_000_000);

    // Record waste adjustment: -500 g -> 7,000 g
    const adj = await owner.mutation(api.inventory.recordAdjustment, {
      inventoryItemId: itemId,
      deltaMicros: -500_000_000,
      kind: "waste",
      reason: "Merma de corte",
    });
    expect(adj.newStockMicros).toBe(7_000_000_000);

    snap = await owner.query(api.inventory.snapshot);
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({ status: "normal", lastCostCents: 125_000 });
    expect(snap.movements).toHaveLength(4);

    // Removing an item that has movements archives it instead of deleting history.
    await owner.mutation(api.inventory.removeItem, { inventoryItemId: itemId });
    snap = await owner.query(api.inventory.snapshot);
    expect(snap.items[0].isActive).toBe(false);

    // Re-adding an archived item by name automatically restores it and adds stock.
    const restoredViaAdd = await owner.mutation(api.inventory.createItem, {
      name: "SALMON",
      unit: "g",
      category: "Pescados y mariscos",
      presentation: "Caja de 5 kg",
      factorMicros: 5_000_000_000,
      initialMicros: 500_000_000,
    });
    expect(restoredViaAdd).toMatchObject({
      itemId,
      merged: true,
      newStockMicros: 7_500_000_000,
    });
    expect((await owner.query(api.inventory.snapshot)).items[0].isActive).toBe(true);

    // Non-owner/manager cannot access inventory.
    const waiter = await authenticatedCaller(t, "inv-waiter@example.com");
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Mesero", code, roles: ["waiter"] },
    });
    await expect(waiter.query(api.inventory.snapshot)).rejects.toThrow(/permiso/);
  });

  it("manages menu categories, modifiers, dishes with descriptions and exact recipe quantities", async () => {
    const t = setupRestaurantTest();
    const { owner } = await createRestaurant(t);

    const { itemId: beefId } = await owner.mutation(api.inventory.createItem, {
      name: "Carne de res",
      unit: "g",
      category: "Carnes",
      minMicros: 2_000_000_000,
      presentation: "Bulto 5 kg",
      factorMicros: 5_000_000_000,
      initialMicros: 2_000_000_000,
    });
    const { itemId: cheeseId } = await owner.mutation(api.inventory.createItem, {
      name: "Queso manchego",
      unit: "g",
      category: "Lácteos y huevo",
      minMicros: 1_000_000_000,
      presentation: "Bloque 1 kg",
      factorMicros: 1_000_000_000,
      initialMicros: 0, // out of stock!
    });

    const cat1 = await owner.mutation(api.menu.createCategory, { name: "Entradas" });
    const cat2 = await owner.mutation(api.menu.createCategory, { name: "Platos fuertes" });
    await owner.mutation(api.menu.moveCategory, { categoryId: cat2, direction: "up" });

    const groupId = await owner.mutation(api.menu.createModifierGroup, {
      name: "Extras",
      required: false,
      multi: true,
      options: [
        { name: "Extra queso", priceExtraCents: 2500, inventoryItemId: cheeseId, quantityDeltaMicros: 30_000_000 },
      ],
    });

    const dishId = await owner.mutation(api.menu.createDish, {
      name: "Rollo dragón",
      description: "Sushi preparado en barra y cocina.",
      priceCents: 21500,
      categoryId: cat2,
      areas: ["kitchen", "bar"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [groupId],
      recipe: [
        { inventoryItemId: beefId, quantityMicros: 150_000_000 },
        { inventoryItemId: cheeseId, quantityMicros: 40_000_000 },
      ],
    });

    const menuSnap = await owner.query(api.menu.snapshot);
    expect(menuSnap.enabledAreas).toEqual(["kitchen", "bar", "cocktails", "coffee"]);
    expect(menuSnap.categories.map((c) => c.name)).toEqual(["Platos fuertes", "Entradas"]);
    expect(menuSnap.dishes).toHaveLength(1);
    expect(menuSnap.dishes[0]).toMatchObject({
      _id: dishId,
      name: "Rollo dragón",
      description: "Sushi preparado en barra y cocina.",
      priceCents: 21500,
      areas: ["kitchen", "bar"],
      soldByIngredient: true, // cheeseId has 0 stock and autoSoldOut defaults to true
    });
    expect(menuSnap.dishes[0].recipe).toHaveLength(2);
    expect(menuSnap.modifierGroups[0].options[0]).toMatchObject({
      name: "Extra queso",
      priceExtraCents: 2500,
      quantityDeltaMicros: 30_000_000,
    });

    // Can toggle individual preparation areas off, but cannot disable all of them.
    const afterDisable = await owner.mutation(api.menu.setPreparationAreaEnabled, {
      area: "coffee",
      enabled: false,
    });
    expect(afterDisable).toEqual(["kitchen", "bar", "cocktails"]);
    await owner.mutation(api.menu.setPreparationAreaEnabled, { area: "cocktails", enabled: false });
    await owner.mutation(api.menu.setPreparationAreaEnabled, { area: "bar", enabled: false });
    await expect(
      owner.mutation(api.menu.setPreparationAreaEnabled, { area: "kitchen", enabled: false }),
    ).rejects.toThrow(/al menos un área/);

    // Category with dishes cannot be removed.
    await expect(owner.mutation(api.menu.removeCategory, { categoryId: cat2 })).rejects.toThrow(/tiene productos/);
    await expect(owner.mutation(api.menu.removeCategory, { categoryId: cat1 })).resolves.toBeNull();
  });

  it("manages buffet menus linked to dishes", async () => {
    const t = setupRestaurantTest();
    const { owner } = await createRestaurant(t);

    const dishId = await owner.mutation(api.menu.createDish, {
      name: "Chilaquiles verdes",
      description: "Con crema y queso fresco.",
      priceCents: 12000,
      areas: ["kitchen"],
      isPublished: true,
      isAvailable: true,
      modifierGroupIds: [],
      recipe: [],
    });

    const menuId = await owner.mutation(api.buffet.createMenu, {
      name: "Buffet dominical",
      menuDate: "2026-11-22",
      isActive: true,
      dishIds: [dishId],
    });

    let snap = await owner.query(api.buffet.snapshot);
    expect(snap.menus).toHaveLength(1);
    expect(snap.menus[0].dishes.map((d) => d.name)).toEqual(["Chilaquiles verdes"]);

    await owner.mutation(api.buffet.toggleMenuActive, { menuId });
    snap = await owner.query(api.buffet.snapshot);
    expect(snap.menus[0].isActive).toBe(false);

    await owner.mutation(api.buffet.removeMenu, { menuId });
    expect((await owner.query(api.buffet.snapshot)).menus).toHaveLength(0);
  });

  it("manages QR tokens, features, members (owner-only) and branches", async () => {
    const t = setupRestaurantTest();
    const { owner, code } = await createRestaurant(t);

    // Table QR regeneration & pause
    const sectionId = await owner.mutation(api.floor.createSection, {
      name: "Salón",
      canvas: { x: 1, y: 1, width: 48, height: 28 },
    });
    const tableId = await owner.mutation(api.floor.createTable, {
      sectionId,
      tableNumber: "Mesa 1",
      x: 50,
      y: 50,
    });
    const beforeQr = (await owner.query(api.floor.snapshot)).tables[0].qrToken;
    const regen = await owner.mutation(api.floor.regenerateTableQr, { tableId });
    expect(regen.qrVersion).toBe(2);
    expect(regen.qrToken).not.toBe(beforeQr);
    await owner.mutation(api.floor.setTableQrEnabled, { tableId, enabled: false });
    expect((await owner.query(api.floor.snapshot)).tables[0].qrEnabled).toBe(false);

    // Features update
    await owner.mutation(api.admin.updateFeatures, {
      autoSoldOut: false,
      autoLateOrderMinutes: 25,
      serviceMode: "buffet",
      guestOrderMode: "direct",
      restrictWaitersToAssignedTables: true,
    });
    const features = await owner.query(api.admin.featuresSnapshot);
    expect(features).toMatchObject({
      autoSoldOut: false,
      autoLateOrderMinutes: 25,
      serviceMode: "buffet",
      guestOrderMode: "direct",
      restrictWaitersToAssignedTables: true,
    });

    // Members: promote a waiter to manager, verify manager can read but cannot edit roles
    const staffCaller = await authenticatedCaller(t, "mgr@example.com");
    await staffCaller.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Daniel", code, roles: ["waiter"] },
    });
    const membersBefore = await owner.query(api.admin.membersSnapshot);
    const daniel = membersBefore.members.find((m) => m.displayName === "Daniel")!;
    await owner.mutation(api.admin.updateMemberRoles, {
      memberId: daniel._id,
      roles: ["manager", "waiter"],
    });
    const mgrSnap = await staffCaller.query(api.admin.membersSnapshot);
    expect(mgrSnap.isOwner).toBe(false);
    await expect(
      staffCaller.mutation(api.admin.toggleMemberActive, { memberId: daniel._id }),
    ).rejects.toThrow(/permiso/);

    // Owner deactivates Daniel -> Daniel can no longer query admin snapshots
    await owner.mutation(api.admin.toggleMemberActive, { memberId: daniel._id });
    await expect(staffCaller.query(api.admin.featuresSnapshot)).rejects.toThrow(/permiso/);

    // Branches: create, switch, update, remove
    const branch2 = await owner.mutation(api.admin.createBranch, {
      name: "Sucursal Condesa",
      address: "Av. Tamaulipas 50",
      timeZone: "America/Mexico_City",
    });
    const branchSnap = await owner.query(api.admin.branchesSnapshot);
    expect(branchSnap.branches).toHaveLength(2);
    const branch1 = branchSnap.currentLocationId;

    await owner.mutation(api.admin.switchBranch, { locationId: branch2 });
    expect((await owner.query(api.admin.branchesSnapshot)).currentLocationId).toBe(branch2);
    // Cannot delete active branch
    await expect(owner.mutation(api.admin.removeBranch, { locationId: branch2 })).rejects.toThrow(/en uso/);
    await owner.mutation(api.admin.switchBranch, { locationId: branch1 });
    await owner.mutation(api.admin.removeBranch, { locationId: branch2 });
    expect((await owner.query(api.admin.branchesSnapshot)).branches).toHaveLength(1);
  });
});
