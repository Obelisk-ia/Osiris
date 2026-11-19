import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, requiredText, safeInteger } from "./model/access";

const EDITORS = ["owner", "manager"] as const;
const unitValidator = v.union(v.literal("g"), v.literal("ml"), v.literal("each"));
const statusValidator = v.union(
  v.literal("normal"),
  v.literal("low"),
  v.literal("out"),
  v.literal("negative"),
);

async function editor(ctx: MutationCtx | QueryCtx) {
  return await requireStaff(ctx, undefined, undefined, EDITORS);
}

function normalizeName(name: string) {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function resolveMinMicros(item: Doc<"inventoryItems">): number {
  if (item.minMicros !== undefined) return item.minMicros;
  if (item.maxMicros !== undefined && item.maxMicros > 0) {
    return Math.round((item.maxMicros * (item.thresholdPct ?? 20)) / 100);
  }
  return 0;
}

function stockStatus(stockMicros: number, minMicros: number) {
  if (stockMicros < 0) return "negative" as const;
  if (stockMicros === 0) return "out" as const;
  if (minMicros > 0 && stockMicros <= minMicros) return "low" as const;
  return "normal" as const;
}

const itemView = v.object({
  _id: v.id("inventoryItems"),
  _creationTime: v.number(),
  name: v.string(),
  unit: unitValidator,
  isActive: v.boolean(),
  category: v.string(),
  minMicros: v.number(),
  presentation: v.string(),
  factorMicros: v.number(),
  lastCostCents: v.number(),
  stockMicros: v.number(),
  status: statusValidator,
  usedInRecipe: v.boolean(),
});

const movementView = v.object({
  _id: v.id("inventoryMovements"),
  _creationTime: v.number(),
  inventoryItemId: v.id("inventoryItems"),
  itemName: v.string(),
  unit: unitValidator,
  kind: schema.doc("inventoryMovements").fields.kind,
  quantityDeltaMicros: v.number(),
  reason: v.string(),
  createdByName: v.string(),
});

export const snapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    items: v.array(itemView),
    movements: v.array(movementView),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const [restaurant, location, items, balances, movements, staffList] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(200),
      ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(200),
      ctx.db
        .query("inventoryMovements")
        .withIndex("by_locationId", (q) => q.eq("locationId", staff.locationId))
        .order("desc")
        .take(80),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId))
        .take(100),
    ]);

    const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));
    const itemMap = new Map(items.map((i) => [i._id, i] as const));
    const staffMap = new Map(staffList.map((s) => [s._id, s.displayName] as const));

    const itemViews = await Promise.all(
      items.map(async (item) => {
        const stockMicros = balanceMap.get(item._id) ?? 0;
        const minMicros = resolveMinMicros(item);
        const factorMicros = item.factorMicros ?? 1_000_000;
        const [inDish, inMod] = await Promise.all([
          ctx.db
            .query("recipeIngredients")
            .withIndex("by_inventoryItemId", (q) => q.eq("inventoryItemId", item._id))
            .take(1),
          ctx.db
            .query("modifierRecipeIngredients")
            .withIndex("by_inventoryItemId", (q) => q.eq("inventoryItemId", item._id))
            .take(1),
        ]);
        return {
          _id: item._id,
          _creationTime: item._creationTime,
          name: item.name,
          unit: item.unit,
          isActive: item.isActive,
          category: item.category ?? "General",
          minMicros,
          presentation:
            item.presentation ?? (item.unit === "each" ? "Pieza" : item.unit === "ml" ? "Litro" : "Kilogramo"),
          factorMicros,
          lastCostCents: item.lastCostCents ?? 0,
          stockMicros,
          status: stockStatus(stockMicros, minMicros),
          usedInRecipe: inDish.length > 0 || inMod.length > 0,
        };
      }),
    );

    const movementViews = movements.map((mov) => {
      const item = itemMap.get(mov.inventoryItemId);
      return {
        _id: mov._id,
        _creationTime: mov._creationTime,
        inventoryItemId: mov.inventoryItemId,
        itemName: item?.name ?? "Insumo borrado",
        unit: item?.unit ?? ("each" as const),
        kind: mov.kind,
        quantityDeltaMicros: mov.quantityDeltaMicros,
        reason: mov.reason,
        createdByName: staffMap.get(mov.createdByStaffId) ?? "Personal",
      };
    });

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      items: itemViews,
      movements: movementViews,
    };
  },
});

async function applyBalanceDelta(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  inventoryItemId: Id<"inventoryItems">,
  deltaMicros: number,
) {
  const existing = await ctx.db
    .query("inventoryBalances")
    .withIndex("by_locationId_and_inventoryItemId", (q) =>
      q.eq("locationId", staff.locationId).eq("inventoryItemId", inventoryItemId),
    )
    .unique();
  const next = (existing?.quantityMicros ?? 0) + deltaMicros;
  if (!Number.isSafeInteger(next)) {
    throw new ConvexError("La cantidad excede el límite permitido.");
  }
  if (existing) {
    await ctx.db.patch("inventoryBalances", existing._id, {
      quantityMicros: next,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("inventoryBalances", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      inventoryItemId,
      quantityMicros: next,
      updatedAt: Date.now(),
    });
  }
  return next;
}

export const createItem = mutation({
  args: {
    name: v.string(),
    unit: unitValidator,
    category: v.string(),
    minMicros: v.optional(v.number()),
    presentation: v.string(),
    factorMicros: v.number(),
    initialMicros: v.optional(v.number()),
  },
  returns: v.object({
    itemId: v.id("inventoryItems"),
    merged: v.boolean(),
    addedMicros: v.number(),
    newStockMicros: v.number(),
    itemName: v.string(),
    unit: unitValidator,
  }),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre del insumo", 100);
    const category = requiredText(args.category, "Categoría", 60);
    const presentation = requiredText(args.presentation, "Presentación de compra", 80);
    const factorMicros = safeInteger(args.factorMicros, "Equivalencia", 1);
    const minMicros = safeInteger(args.minMicros ?? 0, "Mínimo de alerta", 0);
    const initialMicros = safeInteger(args.initialMicros ?? 0, "Existencia inicial", 0);

    // Match existing items case- and accent-insensitively so adding "salmon"
    // naturally adds stock to an existing "Salmón" instead of blocking or duplicating.
    const allItems = await ctx.db
      .query("inventoryItems")
      .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
      .take(200);
    const targetNorm = normalizeName(name);
    const existing = allItems.find((item) => normalizeName(item.name) === targetNorm);

    if (existing) {
      if (existing.unit !== args.unit) {
        const unitName = existing.unit === "each" ? "pza" : existing.unit;
        throw new ConvexError(
          `${existing.name} ya existe en ${unitName}. Usa esa misma unidad para sumarlo a su existencia.`,
        );
      }

      if (!existing.isActive) {
        await ctx.db.patch("inventoryItems", existing._id, { isActive: true });
      }

      const newStockMicros =
        initialMicros > 0
          ? await applyBalanceDelta(ctx, staff, existing._id, initialMicros)
          : (
              await ctx.db
                .query("inventoryBalances")
                .withIndex("by_locationId_and_inventoryItemId", (q) =>
                  q.eq("locationId", staff.locationId).eq("inventoryItemId", existing._id),
                )
                .unique()
            )?.quantityMicros ?? 0;

      if (initialMicros > 0) {
        await ctx.db.insert("inventoryMovements", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          inventoryItemId: existing._id,
          kind: "receipt",
          quantityDeltaMicros: initialMicros,
          referenceId: `merge:${existing._id}:${Date.now()}`,
          reason: "Sumado al insumo existente",
          createdByStaffId: staff._id,
        });
      }

      return {
        itemId: existing._id,
        merged: true,
        addedMicros: initialMicros,
        newStockMicros,
        itemName: existing.name,
        unit: existing.unit,
      };
    }

    const itemId = await ctx.db.insert("inventoryItems", {
      organizationId: staff.organizationId,
      name,
      unit: args.unit,
      isActive: true,
      category,
      minMicros,
      presentation,
      factorMicros,
      lastCostCents: 0,
    });

    await ctx.db.insert("inventoryBalances", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      inventoryItemId: itemId,
      quantityMicros: initialMicros,
      updatedAt: Date.now(),
    });

    if (initialMicros > 0) {
      await ctx.db.insert("inventoryMovements", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        inventoryItemId: itemId,
        kind: "receipt",
        quantityDeltaMicros: initialMicros,
        referenceId: `initial:${itemId}:${Date.now()}`,
        reason: "Existencia inicial",
        createdByStaffId: staff._id,
      });
    }

    return {
      itemId,
      merged: false,
      addedMicros: initialMicros,
      newStockMicros: initialMicros,
      itemName: name,
      unit: args.unit,
    };
  },
});

export const updateItem = mutation({
  args: {
    inventoryItemId: v.id("inventoryItems"),
    name: v.string(),
    unit: unitValidator,
    category: v.string(),
    minMicros: v.optional(v.number()),
    presentation: v.string(),
    factorMicros: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const item = await ctx.db.get("inventoryItems", args.inventoryItemId);
    if (!item || item.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese insumo.");
    }
    const name = requiredText(args.name, "Nombre del insumo", 100);
    const category = requiredText(args.category, "Categoría", 60);
    const presentation = requiredText(args.presentation, "Presentación de compra", 80);
    const factorMicros = safeInteger(args.factorMicros, "Equivalencia", 1);
    const minMicros = safeInteger(args.minMicros ?? 0, "Mínimo de alerta", 0);

    const allItems = await ctx.db
      .query("inventoryItems")
      .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
      .take(200);
    const targetNorm = normalizeName(name);
    const duplicate = allItems.find((other) => other._id !== item._id && normalizeName(other.name) === targetNorm);
    if (duplicate) {
      throw new ConvexError(`Ya existe un insumo llamado ${duplicate.name}.`);
    }

    await ctx.db.patch("inventoryItems", item._id, {
      name,
      unit: args.unit,
      category,
      minMicros,
      presentation,
      factorMicros,
    });
    return null;
  },
});

export const archiveItem = mutation({
  args: { inventoryItemId: v.id("inventoryItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const item = await ctx.db.get("inventoryItems", args.inventoryItemId);
    if (!item || item.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese insumo.");
    }
    await ctx.db.patch("inventoryItems", item._id, { isActive: false });
    return null;
  },
});

export const restoreItem = mutation({
  args: { inventoryItemId: v.id("inventoryItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const item = await ctx.db.get("inventoryItems", args.inventoryItemId);
    if (!item || item.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese insumo.");
    }
    await ctx.db.patch("inventoryItems", item._id, { isActive: true });
    return null;
  },
});

export const removeItem = mutation({
  args: { inventoryItemId: v.id("inventoryItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const item = await ctx.db.get("inventoryItems", args.inventoryItemId);
    if (!item || item.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese insumo.");
    }
    const [inDish, inMod, movs] = await Promise.all([
      ctx.db
        .query("recipeIngredients")
        .withIndex("by_inventoryItemId", (q) => q.eq("inventoryItemId", item._id))
        .take(1),
      ctx.db
        .query("modifierRecipeIngredients")
        .withIndex("by_inventoryItemId", (q) => q.eq("inventoryItemId", item._id))
        .take(1),
      ctx.db
        .query("inventoryMovements")
        .withIndex("by_locationId_and_inventoryItemId", (q) =>
          q.eq("locationId", staff.locationId).eq("inventoryItemId", item._id),
        )
        .take(1),
    ]);
    if (inDish.length > 0 || inMod.length > 0 || movs.length > 0) {
      await ctx.db.patch("inventoryItems", item._id, { isActive: false });
      return null;
    }
    const balance = await ctx.db
      .query("inventoryBalances")
      .withIndex("by_locationId_and_inventoryItemId", (q) =>
        q.eq("locationId", staff.locationId).eq("inventoryItemId", item._id),
      )
      .unique();
    if (balance) await ctx.db.delete("inventoryBalances", balance._id);
    await ctx.db.delete("inventoryItems", item._id);
    return null;
  },
});

export const recordEntry = mutation({
  args: {
    inventoryItemId: v.id("inventoryItems"),
    addedMicros: v.number(),
    costCents: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.object({ newStockMicros: v.number() }),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const item = await ctx.db.get("inventoryItems", args.inventoryItemId);
    if (!item || !item.isActive || item.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese insumo activo.");
    }
    const addedMicros = safeInteger(args.addedMicros, "Cantidad de entrada", 1);
    const costCents = args.costCents !== undefined ? safeInteger(args.costCents, "Costo", 0) : undefined;
    const newStockMicros = await applyBalanceDelta(ctx, staff, item._id, addedMicros);

    if (costCents !== undefined) {
      await ctx.db.patch("inventoryItems", item._id, { lastCostCents: costCents });
    }

    await ctx.db.insert("inventoryMovements", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      inventoryItemId: item._id,
      kind: "receipt",
      quantityDeltaMicros: addedMicros,
      referenceId: `receipt:${item._id}:${Date.now()}`,
      reason: args.note?.trim().slice(0, 140) || "Entrada de mercancía",
      createdByStaffId: staff._id,
    });

    return { newStockMicros };
  },
});

export const recordAdjustment = mutation({
  args: {
    inventoryItemId: v.id("inventoryItems"),
    deltaMicros: v.number(),
    kind: v.union(v.literal("adjustment"), v.literal("waste")),
    reason: v.string(),
  },
  returns: v.object({ newStockMicros: v.number() }),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const item = await ctx.db.get("inventoryItems", args.inventoryItemId);
    if (!item || !item.isActive || item.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese insumo activo.");
    }
    if (!Number.isSafeInteger(args.deltaMicros) || args.deltaMicros === 0) {
      throw new ConvexError("Escribe una diferencia distinta de cero.");
    }
    const reason = requiredText(args.reason, "Motivo del ajuste", 140);
    const newStockMicros = await applyBalanceDelta(ctx, staff, item._id, args.deltaMicros);

    await ctx.db.insert("inventoryMovements", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      inventoryItemId: item._id,
      kind: args.kind,
      quantityDeltaMicros: args.deltaMicros,
      referenceId: `${args.kind}:${item._id}:${Date.now()}`,
      reason,
      createdByStaffId: staff._id,
    });

    return { newStockMicros };
  },
});
