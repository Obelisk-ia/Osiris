/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

const first = { x: 1, y: 1, width: 48, height: 28 };

async function seed() {
  const t = setupRestaurantTest();
  const { owner, code } = await createRestaurant(t);
  const sectionId = await owner.mutation(api.floor.createSection, { name: "Salón", canvas: first });
  const tableTypeId = await owner.mutation(api.floor.createTableType, {
    name: "Redonda", shape: "round", seatCount: 4, isActive: true,
  });
  return { t, owner, code, sectionId, tableTypeId };
}

describe("owner floor plan", () => {
  it("starts empty and builds sections, table types and tables with derived status", async () => {
    const t = setupRestaurantTest();
    const { owner } = await createRestaurant(t);
    expect(await owner.query(api.floor.snapshot)).toMatchObject({ canEdit: true, sections: [], tables: [], tableTypes: [] });

    const { sectionId, tableTypeId } = await seedFrom(owner);
    const tableId = await owner.mutation(api.floor.createTable, {
      sectionId, tableTypeId, tableNumber: "Mesa 1", x: 50, y: 50,
    });
    const view = await owner.query(api.floor.snapshot);
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]).toMatchObject({ name: "Salón", tableCount: 1 });
    expect(view.tableTypes).toMatchObject([{ name: "Redonda", seatCount: 4, shape: "round" }]);
    expect(view.tables).toMatchObject([{ _id: tableId, tableNumber: "Mesa 1", status: "empty", seatCount: 4 }]);
    expect(view.waiters).toEqual([]);

    await owner.mutation(api.floor.setTableStatus, { tableId, status: "occupied" });
    expect((await owner.query(api.floor.snapshot)).tables[0].status).toBe("occupied");
  });

  it("allows overlapping sections and controls their stacking order", async () => {
    const { owner, sectionId, tableTypeId } = await seed();
    const overlay = await owner.mutation(api.floor.createSection, { name: "Encimada", canvas: first });
    let view = await owner.query(api.floor.snapshot);
    expect(view.sections).toHaveLength(2);
    expect(view.sections[1]._id).toBe(overlay);

    // Moving over another section is allowed and brings the moved one to front.
    await owner.mutation(api.floor.moveSection, {
      sectionId, canvas: { x: 3, y: 1, width: 48, height: 28, rotation: 0 },
    });
    view = await owner.query(api.floor.snapshot);
    expect(view.sections[1]._id).toBe(sectionId);

    await owner.mutation(api.floor.setSectionLayer, { sectionId: overlay, layer: "front" });
    view = await owner.query(api.floor.snapshot);
    expect(view.sections[1]._id).toBe(overlay);
    await owner.mutation(api.floor.setSectionLayer, { sectionId, layer: "front" });
    await owner.mutation(api.floor.setSectionLayer, { sectionId: overlay, layer: "back" });
    view = await owner.query(api.floor.snapshot);
    expect(view.sections[0]._id).toBe(overlay);

    // Table placement limits still apply.
    await expect(owner.mutation(api.floor.createTable, {
      sectionId, tableTypeId, tableNumber: "Mesa 1", x: 4, y: 50,
    })).rejects.toThrow(/Posición/);
    await owner.mutation(api.floor.createTable, { sectionId, tableTypeId, tableNumber: "Mesa 1", x: 50, y: 50 });
    await expect(owner.mutation(api.floor.createTable, { sectionId, tableTypeId, tableNumber: "Mesa 1", x: 60, y: 60 }))
      .rejects.toThrow(/Ya existe/);
  });

  it("protects sections with tables and types in use from deletion", async () => {
    const { owner, sectionId, tableTypeId } = await seed();
    await owner.mutation(api.floor.createTable, { sectionId, tableTypeId, tableNumber: "Mesa 1", x: 50, y: 50 });
    await expect(owner.mutation(api.floor.removeSection, { sectionId })).rejects.toThrow(/tiene mesas/);
    await expect(owner.mutation(api.floor.removeTableType, { tableTypeId })).rejects.toThrow(/tiene mesas/);
    const tableId = (await owner.query(api.floor.snapshot)).tables[0]._id;
    await owner.mutation(api.floor.removeTable, { tableId });
    expect((await owner.query(api.floor.snapshot)).tables).toEqual([]);
    await expect(owner.mutation(api.floor.removeSection, { sectionId })).resolves.toBeNull();
    await expect(owner.mutation(api.floor.removeTableType, { tableTypeId })).resolves.toBeNull();
  });

  it("keeps floor editing owner-only and floor reading operational-role-only", async () => {
    const { t, owner, code } = await seed();
    const waiter = await authenticatedCaller(t, "floor-waiter@example.com");
    await waiter.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Mesero", code, roles: ["waiter"] },
    });
    await expect(waiter.mutation(api.floor.createSection, { name: "No", canvas: { x: 1, y: 40, width: 48, height: 28 } }))
      .rejects.toThrow(/permiso/);
    expect((await waiter.query(api.floor.snapshot)).canEdit).toBe(false);
    expect(await owner.query(api.floor.snapshot)).toMatchObject({ canEdit: true });

    const kitchen = await authenticatedCaller(t, "floor-chef@example.com");
    await kitchen.mutation(api.restaurants.completeRegistration, {
      registration: { kind: "staff", displayName: "Chef", code, roles: ["chef"] },
    });
    await expect(kitchen.query(api.floor.snapshot)).rejects.toThrow(/permiso/);
  });
});

async function seedFrom(owner: Awaited<ReturnType<typeof createRestaurant>>["owner"]) {
  const sectionId = await owner.mutation(api.floor.createSection, { name: "Salón", canvas: first });
  const tableTypeId = await owner.mutation(api.floor.createTableType, {
    name: "Redonda", shape: "round", seatCount: 4, isActive: true,
  });
  return { sectionId, tableTypeId };
}
