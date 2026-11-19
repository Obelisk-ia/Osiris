import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import type { Doc, Id } from "./_generated/dataModel";

const EDITORS = ["owner", "manager"] as const;

const tableStatus = v.union(
  v.literal("empty"), v.literal("occupied"), v.literal("attended"), v.literal("payment"),
);

const sectionView = v.object({
  ...schema.doc("sections").fields,
  assignedStaffId: v.union(v.id("staff"), v.null()),
  tableCount: v.number(),
});
const tableView = v.object({
  ...schema.doc("diningTables").fields,
  status: tableStatus,
  typeName: v.union(v.string(), v.null()),
});
const staffView = v.object({ id: v.id("staff"), name: v.string() });

function validCanvas(value: { x: number; y: number; width: number; height: number }, field = "Posición") {
  const { x, y, width, height } = value;
  if ([x, y, width, height].some((part) => !Number.isFinite(part))) {
    throw new ConvexError(`${field}: valores no válidos.`);
  }
  if (x < 0 || y < 0 || width < 10 || height < 8 || x + width > 100.5 || y + height > 1000) {
    throw new ConvexError(`${field}: el ancho va de 0 a 100 y la sección debe caber en el plano.`);
  }
  return { x, y, width, height, rotation: 0 };
}

async function sectionsFor(ctx: QueryCtx, locationId: Doc<"staff">["locationId"]) {
  return await ctx.db.query("sections")
    .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", locationId))
    .take(50);
}

async function assignedStaff(ctx: QueryCtx, sectionId: Id<"sections">) {
  const assignments = await ctx.db.query("sectionAssignments")
    .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", sectionId))
    .order("desc")
    .take(1);
  const active = assignments[0];
  return active && active.endsAt === undefined ? active.assignedStaffId : null;
}

async function tableStatusFor(ctx: QueryCtx, table: Doc<"diningTables">): Promise<Doc<"diningTables">["status"]> {
  if (!table.currentAccountId) return table.status;
  const account = await ctx.db.get("accounts", table.currentAccountId);
  if (!account || account.state === "closed" || account.state === "voided") return "empty";
  if (account.state === "awaiting_payment") return "payment";
  if (account.state === "open") {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(30);
    for (const order of orders) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(50);
      if (items.some((item) => item.status === "ready")) {
        return "attended";
      }
    }
    return "occupied";
  }
  return table.status;
}

export const snapshot = query({
  args: {},
  returns: v.object({
    canEdit: v.boolean(),
    restaurantName: v.string(),
    sections: v.array(sectionView),
    tableTypes: v.array(schema.doc("tableTypes")),
    tables: v.array(tableView),
    waiters: v.array(staffView),
  }),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, undefined, undefined, ["owner", "manager", "waiter"]);
    const [sections, types, tables, waiters] = await Promise.all([
      sectionsFor(ctx, staff.locationId),
      ctx.db.query("tableTypes").withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId)).take(50),
      ctx.db.query("diningTables").withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true)).take(100),
      ctx.db.query("staff").withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true)).take(50),
    ]);
    const sectionViews = await Promise.all(sections.map(async (section) => ({
      ...section,
      assignedStaffId: await assignedStaff(ctx, section._id),
      tableCount: tables.filter((table) => table.sectionId === section._id).length,
    })));
    // Older test types may still carry unused width/height fields; strip them
    // so the return validator accepts both old and new documents.
    const typeViews = types.map((type) => ({
      _id: type._id, _creationTime: type._creationTime,
      organizationId: type.organizationId, locationId: type.locationId,
      name: type.name, shape: type.shape, seatCount: type.seatCount, isActive: type.isActive,
    }));
    const typeNames = new Map(types.map((type) => [type._id, type.name] as const));
    const tableViews = await Promise.all(tables.map(async (table) => ({
      ...table,
      status: await tableStatusFor(ctx, table),
      typeName: table.tableTypeId ? typeNames.get(table.tableTypeId) ?? null : null,
    })));
    const restaurant = await ctx.db.get("organizations", staff.organizationId);
    return {
      canEdit: staff.roles.some((role) => (EDITORS as ReadonlyArray<string>).includes(role)),
      restaurantName: restaurant?.name ?? "Tu restaurante",
      sections: sectionViews,
      tableTypes: typeViews,
      tables: tableViews,
      waiters: waiters
        .filter((member) => member.roles.includes("waiter"))
        .map((member) => ({ id: member._id, name: member.displayName })),
    };
  },
});

async function editor(ctx: MutationCtx) {
  return await requireStaff(ctx, undefined, undefined, EDITORS);
}

function canvasForTable(section: Doc<"sections">, x: number, y: number) {
  if ([x, y].some((part) => !Number.isFinite(part)) || x < 8 || x > 92 || y < 12 || y > 88) {
    throw new ConvexError("Posición: coloca la mesa dentro del 8–92 % de ancho y 12–88 % de alto de la sección.");
  }
  return { x, y, width: section.canvas.width, height: section.canvas.height, rotation: 0 } satisfies Doc<"diningTables">["canvas"];
}

export const createSection = mutation({
  args: {
    name: v.string(), description: v.optional(v.string()),
    canvas: v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
    assignedStaffId: v.optional(v.id("staff")),
  },
  returns: v.id("sections"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre de la sección");
    const desired = validCanvas(args.canvas);
    const sections = await sectionsFor(ctx, staff.locationId);
    if (sections.length >= 30) throw new ConvexError("Llegaste al límite de 30 secciones.");
    // Sections may overlap: the newer one is drawn on top.
    const sectionId = await ctx.db.insert("sections", {
      organizationId: staff.organizationId, locationId: staff.locationId, name,
      description: args.description?.trim().slice(0, 80) || undefined,
      sortOrder: Math.max(0, ...sections.map((section) => section.sortOrder)) + 1, canvas: desired,
    });
    if (args.assignedStaffId) {
      await ctx.db.insert("sectionAssignments", {
        organizationId: staff.organizationId, locationId: staff.locationId, sectionId,
        assignedStaffId: args.assignedStaffId, assignedByStaffId: staff._id, startsAt: Date.now(),
      });
    }
    return sectionId;
  },
});

export const updateSection = mutation({
  args: {
    sectionId: v.id("sections"), name: v.string(), description: v.optional(v.string()),
    canvas: v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
    assignedStaffId: v.optional(v.id("staff")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    const desired = validCanvas(args.canvas);
    await ctx.db.patch("sections", section._id, {
      name: requiredText(args.name, "Nombre de la sección"),
      description: args.description?.trim().slice(0, 80) || undefined,
      canvas: desired,
    });
    const current = await assignedStaff(ctx, section._id);
    if (current !== (args.assignedStaffId ?? null)) {
      const history = await ctx.db.query("sectionAssignments")
        .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", section._id))
        .order("desc").take(1);
      if (history[0]?.endsAt === undefined) {
        await ctx.db.patch("sectionAssignments", history[0]._id, { endsAt: Date.now() });
      }
      if (args.assignedStaffId) {
        await ctx.db.insert("sectionAssignments", {
          organizationId: staff.organizationId, locationId: staff.locationId, sectionId: section._id,
          assignedStaffId: args.assignedStaffId, assignedByStaffId: staff._id, startsAt: Date.now(),
        });
      }
    }
    return null;
  },
});

export const removeSection = mutation({
  args: { sectionId: v.id("sections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    const tables = await ctx.db.query("diningTables")
      .withIndex("by_sectionId_and_tableNumber", (q) => q.eq("sectionId", section._id)).take(50);
    if (tables.some((table) => table.isActive)) {
      throw new ConvexError("Esta sección tiene mesas. Muévelas o quítalas primero.");
    }
    const assignments = await ctx.db.query("sectionAssignments")
      .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", section._id)).take(50);
    for (const assignment of assignments) await ctx.db.delete("sectionAssignments", assignment._id);
    await ctx.db.delete("sections", section._id);
    return null;
  },
});

export const createTableType = mutation({
  args: {
    name: v.string(), shape: schema.doc("tableTypes").fields.shape,
    seatCount: v.number(), isActive: v.boolean(),
  },
  returns: v.id("tableTypes"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre del tipo");
    const seats = safeInteger(args.seatCount, "Sillas", 1);
    if (seats > 12) throw new ConvexError("Un tipo de mesa admite hasta 12 sillas.");
    const existing = await ctx.db.query("tableTypes")
      .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId).eq("name", name)).unique();
    if (existing) throw new ConvexError("Ya existe un tipo de mesa con ese nombre.");
    return await ctx.db.insert("tableTypes", {
      organizationId: staff.organizationId, locationId: staff.locationId, name,
      shape: args.shape, seatCount: seats, isActive: args.isActive,
    });
  },
});

export const updateTableType = mutation({
  args: {
    tableTypeId: v.id("tableTypes"), name: v.string(),
    shape: schema.doc("tableTypes").fields.shape,
    seatCount: v.number(), isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const type = await ctx.db.get("tableTypes", args.tableTypeId);
    if (!type || type.locationId !== staff.locationId) throw new ConvexError("No encontramos ese tipo de mesa.");
    const name = requiredText(args.name, "Nombre del tipo");
    const duplicate = await ctx.db.query("tableTypes")
      .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId).eq("name", name)).unique();
    if (duplicate && duplicate._id !== type._id) throw new ConvexError("Ya existe un tipo de mesa con ese nombre.");
    const seats = safeInteger(args.seatCount, "Sillas", 1);
    if (seats > 12) throw new ConvexError("Un tipo de mesa admite hasta 12 sillas.");
    await ctx.db.patch("tableTypes", type._id, {
      name, shape: args.shape, seatCount: seats, isActive: args.isActive,
    });
    return null;
  },
});

export const createTable = mutation({
  args: {
    sectionId: v.id("sections"), tableTypeId: v.optional(v.id("tableTypes")),
    tableNumber: v.string(), x: v.number(), y: v.number(),
  },
  returns: v.id("diningTables"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    const tableNumber = requiredText(args.tableNumber, "Nombre de la mesa", 40);
    const duplicate = await ctx.db.query("diningTables")
      .withIndex("by_sectionId_and_tableNumber", (q) => q.eq("sectionId", section._id).eq("tableNumber", tableNumber)).unique();
    if (duplicate) throw new ConvexError("Ya existe una mesa con ese nombre en esta sección.");
    const tables = await ctx.db.query("diningTables")
      .withIndex("by_sectionId_and_tableNumber", (q) => q.eq("sectionId", section._id)).take(100);
    if (tables.length >= 60) throw new ConvexError("Llegaste al límite de mesas en esta sección.");
    const type = args.tableTypeId ? await ctx.db.get("tableTypes", args.tableTypeId) : null;
    if (args.tableTypeId && (!type || type.locationId !== staff.locationId)) {
      throw new ConvexError("No encontramos ese tipo de mesa.");
    }
    return await ctx.db.insert("diningTables", {
      organizationId: staff.organizationId, locationId: staff.locationId, sectionId: section._id,
      tableTypeId: type?._id, tableNumber, seatCount: type?.seatCount ?? 4, shape: type?.shape ?? "square",
      canvas: canvasForTable(section, args.x, args.y),
      status: "empty", isActive: true, qrToken: crypto.randomUUID(), qrEnabled: true, qrCreatedAt: Date.now(),
      qrVersion: 1,
    });
  },
});

export const updateTable = mutation({
  args: {
    tableId: v.id("diningTables"), sectionId: v.id("sections"),
    tableTypeId: v.optional(v.id("tableTypes")), tableNumber: v.string(),
    x: v.number(), y: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const table = await ctx.db.get("diningTables", args.tableId);
    if (!table || table.locationId !== staff.locationId) throw new ConvexError("No encontramos esa mesa.");
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    const tableNumber = requiredText(args.tableNumber, "Nombre de la mesa", 40);
    const duplicate = await ctx.db.query("diningTables")
      .withIndex("by_sectionId_and_tableNumber", (q) => q.eq("sectionId", section._id).eq("tableNumber", tableNumber)).unique();
    if (duplicate && duplicate._id !== table._id) throw new ConvexError("Ya existe una mesa con ese nombre en esta sección.");
    const type = args.tableTypeId ? await ctx.db.get("tableTypes", args.tableTypeId) : null;
    if (args.tableTypeId && (!type || type.locationId !== staff.locationId)) {
      throw new ConvexError("No encontramos ese tipo de mesa.");
    }
    await ctx.db.patch("diningTables", table._id, {
      sectionId: section._id, tableTypeId: type?._id, tableNumber,
      seatCount: type?.seatCount ?? table.seatCount, shape: type?.shape ?? table.shape,
      canvas: canvasForTable(section, args.x, args.y),
    });
    return null;
  },
});

export const setTableStatus = mutation({
  args: { tableId: v.id("diningTables"), status: tableStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const table = await ctx.db.get("diningTables", args.tableId);
    if (!table || table.locationId !== staff.locationId) throw new ConvexError("No encontramos esa mesa.");
    if (table.currentAccountId) {
      throw new ConvexError("Esta mesa tiene una cuenta: su estado se calcula solo.");
    }
    await ctx.db.patch("diningTables", table._id, { status: args.status });
    return null;
  },
});

export const moveTable = mutation({
  args: { tableId: v.id("diningTables"), sectionId: v.id("sections"), x: v.number(), y: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const table = await ctx.db.get("diningTables", args.tableId);
    if (!table || table.locationId !== staff.locationId) throw new ConvexError("No encontramos esa mesa.");
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    await ctx.db.patch("diningTables", table._id, {
      sectionId: section._id, canvas: canvasForTable(section, args.x, args.y),
    });
    return null;
  },
});

export const moveSection = mutation({
  args: {
    sectionId: v.id("sections"),
    canvas: v.object({
      x: v.number(), y: v.number(), width: v.number(), height: v.number(), rotation: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    const desired = validCanvas(args.canvas);
    // Overlapping is allowed. The moved section comes to the front so it is
    // clear which one the owner is arranging.
    const sections = await sectionsFor(ctx, staff.locationId);
    await ctx.db.patch("sections", section._id, {
      canvas: desired,
      sortOrder: Math.max(0, ...sections.map((section) => section.sortOrder)) + 1,
    });
    return null;
  },
});

export const setSectionLayer = mutation({
  args: {
    sectionId: v.id("sections"),
    layer: v.union(v.literal("front"), v.literal("back")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (!section || section.locationId !== staff.locationId) throw new ConvexError("No encontramos esa sección.");
    const sections = await sectionsFor(ctx, staff.locationId);
    const orders = sections.map((item) => item.sortOrder);
    const sortOrder = args.layer === "front"
      ? Math.max(0, ...orders) + 1
      : Math.min(0, ...orders) - 1;
    await ctx.db.patch("sections", section._id, { sortOrder });
    return null;
  },
});

export const removeTableType = mutation({
  args: { tableTypeId: v.id("tableTypes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const type = await ctx.db.get("tableTypes", args.tableTypeId);
    if (!type || type.locationId !== staff.locationId) throw new ConvexError("No encontramos ese tipo de mesa.");
    const tables = await ctx.db.query("diningTables").withIndex("by_locationId_and_isActive", (q) =>
      q.eq("locationId", staff.locationId).eq("isActive", true)).take(100);
    if (tables.some((table) => table.tableTypeId === type._id)) {
      throw new ConvexError("Este tipo tiene mesas. Cámbialas o quítalas primero.");
    }
    await ctx.db.delete("tableTypes", type._id);
    return null;
  },
});

export const removeTable = mutation({
  args: { tableId: v.id("diningTables") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const table = await ctx.db.get("diningTables", args.tableId);
    if (!table || table.locationId !== staff.locationId) throw new ConvexError("No encontramos esa mesa.");
    if (table.currentAccountId) {
      const account = await ctx.db.get("accounts", table.currentAccountId);
      if (account && account.state !== "closed" && account.state !== "voided") {
        throw new ConvexError("Esta mesa tiene una cuenta abierta. Ciérrala antes de quitarla.");
      }
    }
    await ctx.db.patch("diningTables", table._id, { isActive: false });
    return null;
  },
});

export const regenerateTableQr = mutation({
  args: { tableId: v.id("diningTables") },
  returns: v.object({ qrToken: v.string(), qrVersion: v.number() }),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const table = await ctx.db.get("diningTables", args.tableId);
    if (!table || !table.isActive || table.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esa mesa.");
    }
    const qrToken = crypto.randomUUID();
    const qrVersion = (table.qrVersion ?? 1) + 1;
    await ctx.db.patch("diningTables", table._id, {
      qrToken,
      qrVersion,
      qrCreatedAt: Date.now(),
    });
    return { qrToken, qrVersion };
  },
});

export const setTableQrEnabled = mutation({
  args: { tableId: v.id("diningTables"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const table = await ctx.db.get("diningTables", args.tableId);
    if (!table || !table.isActive || table.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esa mesa.");
    }
    await ctx.db.patch("diningTables", table._id, { qrEnabled: args.enabled });
    return null;
  },
});
