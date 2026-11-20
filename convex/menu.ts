import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import { resolveDishAreas } from "./model/orders";
import { preparationArea, serviceMode } from "./model/validators";
import { locationPreparationAreas, PREPARATION_AREAS, type PreparationArea } from "../lib/restaurant-roles";

const EDITORS = ["owner", "manager"] as const;
const unitValidator = v.union(v.literal("g"), v.literal("ml"), v.literal("each"));

async function editor(ctx: MutationCtx | QueryCtx) {
  return await requireStaff(ctx, undefined, undefined, EDITORS);
}

function normalizeAreas(raw: readonly PreparationArea[]): PreparationArea[] {
  return PREPARATION_AREAS.filter((area) => raw.includes(area));
}

const recipeEntryView = v.object({
  inventoryItemId: v.id("inventoryItems"),
  itemName: v.string(),
  unit: unitValidator,
  quantityMicros: v.number(),
  currentStockMicros: v.number(),
});

const dishView = v.object({
  _id: v.id("dishes"),
  _creationTime: v.number(),
  name: v.string(),
  description: v.string(),
  priceCents: v.number(),
  isAvailable: v.boolean(),
  isPublished: v.boolean(),
  buffetExtra: v.boolean(),
  areas: v.array(preparationArea),
  categoryId: v.union(v.id("dishCategories"), v.null()),
  categoryName: v.union(v.string(), v.null()),
  photoId: v.union(v.id("_storage"), v.null()),
  photoUrl: v.union(v.string(), v.null()),
  modifierGroupIds: v.array(v.id("modifierGroups")),
  recipe: v.array(recipeEntryView),
  soldByIngredient: v.boolean(),
});

const modifierOptionView = v.object({
  _id: v.id("modifierOptions"),
  name: v.string(),
  priceExtraCents: v.number(),
  sortOrder: v.number(),
  isActive: v.boolean(),
  inventoryItemId: v.union(v.id("inventoryItems"), v.null()),
  inventoryItemName: v.union(v.string(), v.null()),
  inventoryUnit: v.union(unitValidator, v.null()),
  quantityDeltaMicros: v.number(),
});

const modifierGroupView = v.object({
  _id: v.id("modifierGroups"),
  _creationTime: v.number(),
  name: v.string(),
  minSelections: v.number(),
  maxSelections: v.union(v.number(), v.null()),
  sortOrder: v.number(),
  isActive: v.boolean(),
  options: v.array(modifierOptionView),
});

const inventoryPickerView = v.object({
  _id: v.id("inventoryItems"),
  name: v.string(),
  unit: unitValidator,
  stockMicros: v.number(),
});

export const snapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    serviceMode,
    autoSoldOut: v.boolean(),
    enabledAreas: v.array(preparationArea),
    categories: v.array(schema.doc("dishCategories")),
    dishes: v.array(dishView),
    modifierGroups: v.array(modifierGroupView),
    inventoryItems: v.array(inventoryPickerView),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const [restaurant, location, categories, dishes, groups, items, balances] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(200),
      ctx.db
        .query("modifierGroups")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(200),
      ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(200),
    ]);

    const autoSoldOut = location?.autoSoldOut ?? true;
    const categoryMap = new Map(categories.map((c) => [c._id, c.name] as const));
    const itemMap = new Map(items.map((i) => [i._id, i] as const));
    const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));

    const dishViews = await Promise.all(
      dishes.map(async (dish) => {
        const [photoUrl, modLinks, recipeRows] = await Promise.all([
          dish.photoId ? ctx.storage.getUrl(dish.photoId) : Promise.resolve(null),
          ctx.db
            .query("dishModifierGroups")
            .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dish._id))
            .take(50),
          ctx.db
            .query("recipeIngredients")
            .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
            .take(100),
        ]);

        const recipe = recipeRows
          .map((row) => {
            const inv = itemMap.get(row.inventoryItemId);
            if (!inv) return null;
            return {
              inventoryItemId: row.inventoryItemId,
              itemName: inv.name,
              unit: inv.unit,
              quantityMicros: row.quantityMicros,
              currentStockMicros: balanceMap.get(row.inventoryItemId) ?? 0,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        const soldByIngredient =
          autoSoldOut && recipe.some((entry) => entry.currentStockMicros <= 0);

        return {
          _id: dish._id,
          _creationTime: dish._creationTime,
          name: dish.name,
          description: dish.description ?? "",
          priceCents: dish.priceCents,
          isAvailable: dish.isAvailable,
          isPublished: dish.isPublished ?? true,
          areas: resolveDishAreas(dish),
          buffetExtra: dish.buffetExtra ?? false,
          categoryId: dish.categoryId ?? null,
          categoryName: dish.categoryId ? categoryMap.get(dish.categoryId) ?? null : null,
          photoId: dish.photoId ?? null,
          photoUrl,
          modifierGroupIds: modLinks
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((link) => link.modifierGroupId),
          recipe,
          soldByIngredient,
        };
      }),
    );

    const modifierGroupViews = await Promise.all(
      groups
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(async (group) => {
          const options = await ctx.db
            .query("modifierOptions")
            .withIndex("by_modifierGroupId_and_name", (q) => q.eq("modifierGroupId", group._id))
            .take(50);
          const optionViews = await Promise.all(
            options
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(async (opt) => {
                const links = await ctx.db
                  .query("modifierRecipeIngredients")
                  .withIndex("by_modifierOptionId_and_inventoryItemId", (q) =>
                    q.eq("modifierOptionId", opt._id),
                  )
                  .take(1);
                const first = links[0];
                const inv = first ? itemMap.get(first.inventoryItemId) ?? null : null;
                return {
                  _id: opt._id,
                  name: opt.name,
                  priceExtraCents: opt.priceExtraCents,
                  sortOrder: opt.sortOrder,
                  isActive: opt.isActive,
                  inventoryItemId: inv?._id ?? null,
                  inventoryItemName: inv?.name ?? null,
                  inventoryUnit: inv?.unit ?? null,
                  quantityDeltaMicros: first?.quantityDeltaMicros ?? 0,
                };
              }),
          );
          return {
            _id: group._id,
            _creationTime: group._creationTime,
            name: group.name,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections ?? null,
            sortOrder: group.sortOrder,
            isActive: group.isActive,
            options: optionViews,
          };
        }),
    );

    const activeItems = items
      .filter((item) => item.isActive)
      .map((item) => ({
        _id: item._id,
        name: item.name,
        unit: item.unit,
        stockMicros: balanceMap.get(item._id) ?? 0,
      }));

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      autoSoldOut,
      enabledAreas: locationPreparationAreas(location?.enabledPreparationAreas),
      serviceMode: location?.serviceMode ?? "mixed",
      categories,
      dishes: dishViews,
      modifierGroups: modifierGroupViews,
      inventoryItems: activeItems,
    };
  },
});

export const setPreparationAreaEnabled = mutation({
  args: {
    area: preparationArea,
    enabled: v.boolean(),
  },
  returns: v.array(preparationArea),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const location = await ctx.db.get("locations", staff.locationId);
    if (!location || location.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos tu sucursal.");
    }
    const current = new Set(locationPreparationAreas(location.enabledPreparationAreas));
    if (args.enabled) current.add(args.area);
    else current.delete(args.area);
    const next = normalizeAreas([...current]);
    if (next.length === 0) {
      throw new ConvexError("Mantén al menos un área de preparación activa.");
    }
    await ctx.db.patch("locations", location._id, { enabledPreparationAreas: next });
    return next;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await editor(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createCategory = mutation({
  args: { name: v.string() },
  returns: v.id("dishCategories"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre de la categoría", 80);
    const existing = await ctx.db
      .query("dishCategories")
      .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
      .take(100);
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new ConvexError("Ya existe una categoría con ese nombre.");
    }
    const sortOrder = Math.max(0, ...existing.map((c) => c.sortOrder)) + 1;
    return await ctx.db.insert("dishCategories", {
      organizationId: staff.organizationId,
      name,
      sortOrder,
      isActive: true,
    });
  },
});

export const updateCategory = mutation({
  args: { categoryId: v.id("dishCategories"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const category = await ctx.db.get("dishCategories", args.categoryId);
    if (!category || category.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa categoría.");
    }
    const name = requiredText(args.name, "Nombre de la categoría", 80);
    const existing = await ctx.db
      .query("dishCategories")
      .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
      .take(100);
    if (existing.some((c) => c._id !== category._id && c.name.toLowerCase() === name.toLowerCase())) {
      throw new ConvexError("Ya existe una categoría con ese nombre.");
    }
    await ctx.db.patch("dishCategories", category._id, { name });
    return null;
  },
});

export const toggleCategoryActive = mutation({
  args: { categoryId: v.id("dishCategories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const category = await ctx.db.get("dishCategories", args.categoryId);
    if (!category || category.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa categoría.");
    }
    await ctx.db.patch("dishCategories", category._id, { isActive: !category.isActive });
    return null;
  },
});

export const moveCategory = mutation({
  args: { categoryId: v.id("dishCategories"), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const categories = await ctx.db
      .query("dishCategories")
      .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
      .take(100);
    const index = categories.findIndex((c) => c._id === args.categoryId);
    if (index < 0) throw new ConvexError("No encontramos esa categoría.");
    const targetIndex = args.direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return null;
    const current = categories[index];
    const neighbor = categories[targetIndex];
    await ctx.db.patch("dishCategories", current._id, { sortOrder: neighbor.sortOrder });
    await ctx.db.patch("dishCategories", neighbor._id, { sortOrder: current.sortOrder });
    return null;
  },
});

export const removeCategory = mutation({
  args: { categoryId: v.id("dishCategories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const category = await ctx.db.get("dishCategories", args.categoryId);
    if (!category || category.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa categoría.");
    }
    const dishes = await ctx.db
      .query("dishes")
      .withIndex("by_categoryId", (q) => q.eq("categoryId", category._id))
      .take(1);
    if (dishes.length > 0) {
      throw new ConvexError("Esta categoría tiene productos. Muévelos o bórralos primero.");
    }
    await ctx.db.delete("dishCategories", category._id);
    return null;
  },
});

const recipeInput = v.object({
  inventoryItemId: v.id("inventoryItems"),
  quantityMicros: v.number(),
});

async function syncDishRelations(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  dishId: Id<"dishes">,
  modifierGroupIds: Id<"modifierGroups">[],
  recipe: Array<{ inventoryItemId: Id<"inventoryItems">; quantityMicros: number }>,
) {
  const existingMods = await ctx.db
    .query("dishModifierGroups")
    .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dishId))
    .take(50);
  for (const link of existingMods) {
    await ctx.db.delete("dishModifierGroups", link._id);
  }

  const uniqueModIds = [...new Set(modifierGroupIds)].slice(0, 30);
  for (let i = 0; i < uniqueModIds.length; i++) {
    const groupId = uniqueModIds[i];
    const group = await ctx.db.get("modifierGroups", groupId);
    if (!group || group.organizationId !== staff.organizationId) {
      throw new ConvexError("Un grupo de modificadores seleccionado no es válido.");
    }
    await ctx.db.insert("dishModifierGroups", {
      organizationId: staff.organizationId,
      dishId,
      modifierGroupId: groupId,
      sortOrder: i,
    });
  }

  const existingRecipe = await ctx.db
    .query("recipeIngredients")
    .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dishId))
    .take(100);
  for (const row of existingRecipe) {
    await ctx.db.delete("recipeIngredients", row._id);
  }

  if (recipe.length > 100) {
    throw new ConvexError("Una receta admite hasta 100 ingredientes.");
  }
  const merged = new Map<Id<"inventoryItems">, number>();
  for (const entry of recipe) {
    const qty = safeInteger(entry.quantityMicros, "Cantidad del ingrediente", 1);
    const inv = await ctx.db.get("inventoryItems", entry.inventoryItemId);
    if (!inv || inv.organizationId !== staff.organizationId) {
      throw new ConvexError("Uno de los ingredientes seleccionados no pertenece a tu restaurante.");
    }
    const total = (merged.get(entry.inventoryItemId) ?? 0) + qty;
    if (!Number.isSafeInteger(total)) {
      throw new ConvexError("La cantidad del ingrediente excede el límite.");
    }
    merged.set(entry.inventoryItemId, total);
  }

  for (const [inventoryItemId, quantityMicros] of merged) {
    await ctx.db.insert("recipeIngredients", {
      organizationId: staff.organizationId,
      dishId,
      inventoryItemId,
      quantityMicros,
    });
  }
}

export const createDish = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    categoryId: v.optional(v.id("dishCategories")),
    areas: v.array(preparationArea),
    isPublished: v.boolean(),
    buffetExtra: v.optional(v.boolean()),
    isAvailable: v.boolean(),
    photoId: v.optional(v.id("_storage")),
    modifierGroupIds: v.array(v.id("modifierGroups")),
    recipe: v.array(recipeInput),
  },
  returns: v.id("dishes"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre del platillo", 100);
    const description = args.description?.trim().slice(0, 300) || undefined;
    const priceCents = safeInteger(args.priceCents, "Precio", 1);
    const areas = normalizeAreas(args.areas);
    if (areas.length === 0) {
      throw new ConvexError("Elige al menos un área de preparación.");
    }
    if (args.categoryId) {
      const cat = await ctx.db.get("dishCategories", args.categoryId);
      if (!cat || cat.organizationId !== staff.organizationId) {
        throw new ConvexError("No encontramos esa categoría.");
      }
    }
    const dishId = await ctx.db.insert("dishes", {
      organizationId: staff.organizationId,
      name,
      description,
      priceCents,
      categoryId: args.categoryId,
      area: areas.includes("kitchen") ? "cocina" : "barra",
      areas,
      isPublished: args.isPublished,
      buffetExtra: args.buffetExtra,
      isAvailable: args.isAvailable,
      photoId: args.photoId,
    });
    await syncDishRelations(ctx, staff, dishId, args.modifierGroupIds, args.recipe);
    return dishId;
  },
});

export const updateDish = mutation({
  args: {
    dishId: v.id("dishes"),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    categoryId: v.optional(v.id("dishCategories")),
    areas: v.array(preparationArea),
    isPublished: v.boolean(),
    buffetExtra: v.optional(v.boolean()),
    isAvailable: v.boolean(),
    photoId: v.optional(v.id("_storage")),
    removePhoto: v.optional(v.boolean()),
    modifierGroupIds: v.array(v.id("modifierGroups")),
    recipe: v.array(recipeInput),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const dish = await ctx.db.get("dishes", args.dishId);
    if (!dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese platillo.");
    }
    const name = requiredText(args.name, "Nombre del platillo", 100);
    const description = args.description?.trim().slice(0, 300) || undefined;
    const priceCents = safeInteger(args.priceCents, "Precio", 1);
    const areas = normalizeAreas(args.areas);
    if (areas.length === 0) {
      throw new ConvexError("Elige al menos un área de preparación.");
    }
    if (args.categoryId) {
      const cat = await ctx.db.get("dishCategories", args.categoryId);
      if (!cat || cat.organizationId !== staff.organizationId) {
        throw new ConvexError("No encontramos esa categoría.");
      }
    }

    let nextPhotoId = dish.photoId;
    if (args.removePhoto) {
      if (dish.photoId) await ctx.storage.delete(dish.photoId);
      nextPhotoId = undefined;
    } else if (args.photoId && args.photoId !== dish.photoId) {
      if (dish.photoId) await ctx.storage.delete(dish.photoId);
      nextPhotoId = args.photoId;
    }

    await ctx.db.patch("dishes", dish._id, {
      name,
      description,
      priceCents,
      categoryId: args.categoryId,
      area: areas.includes("kitchen") ? "cocina" : "barra",
      areas,
      isPublished: args.isPublished,
      buffetExtra: args.buffetExtra ?? dish.buffetExtra,
      isAvailable: args.isAvailable,
      photoId: nextPhotoId,
    });
    await syncDishRelations(ctx, staff, dish._id, args.modifierGroupIds, args.recipe);
    return null;
  },
});

export const toggleDishAvailable = mutation({
  args: { dishId: v.id("dishes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const dish = await ctx.db.get("dishes", args.dishId);
    if (!dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese platillo.");
    }
    await ctx.db.patch("dishes", dish._id, { isAvailable: !dish.isAvailable });
    return null;
  },
});

export const removeDish = mutation({
  args: { dishId: v.id("dishes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const dish = await ctx.db.get("dishes", args.dishId);
    if (!dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese platillo.");
    }
    const [recipeRows, modLinks, dishStations] = await Promise.all([
      ctx.db
        .query("recipeIngredients")
        .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
        .take(100),
      ctx.db
        .query("dishModifierGroups")
        .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dish._id))
        .take(50),
      ctx.db
        .query("dishStations")
        .withIndex("by_dishId_and_stationId", (q) => q.eq("dishId", dish._id))
        .take(20),
    ]);
    for (const row of recipeRows) await ctx.db.delete("recipeIngredients", row._id);
    for (const link of modLinks) await ctx.db.delete("dishModifierGroups", link._id);
    for (const st of dishStations) await ctx.db.delete("dishStations", st._id);
    if (dish.photoId) await ctx.storage.delete(dish.photoId);
    await ctx.db.delete("dishes", dish._id);
    return null;
  },
});

const modifierOptionInput = v.object({
  name: v.string(),
  priceExtraCents: v.number(),
  inventoryItemId: v.optional(v.id("inventoryItems")),
  quantityDeltaMicros: v.optional(v.number()),
});

async function replaceModifierOptions(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  groupId: Id<"modifierGroups">,
  options: Array<{
    name: string;
    priceExtraCents: number;
    inventoryItemId?: Id<"inventoryItems">;
    quantityDeltaMicros?: number;
  }>,
) {
  if (options.length < 1 || options.length > 30) {
    throw new ConvexError("Agrega entre 1 y 30 opciones al grupo.");
  }
  const existingOptions = await ctx.db
    .query("modifierOptions")
    .withIndex("by_modifierGroupId_and_name", (q) => q.eq("modifierGroupId", groupId))
    .take(50);
  for (const opt of existingOptions) {
    const recs = await ctx.db
      .query("modifierRecipeIngredients")
      .withIndex("by_modifierOptionId_and_inventoryItemId", (q) => q.eq("modifierOptionId", opt._id))
      .take(20);
    for (const r of recs) await ctx.db.delete("modifierRecipeIngredients", r._id);
    await ctx.db.delete("modifierOptions", opt._id);
  }

  for (let i = 0; i < options.length; i++) {
    const raw = options[i];
    const name = requiredText(raw.name, "Nombre de la opción", 80);
    const priceExtraCents = safeInteger(raw.priceExtraCents, "Precio extra", 0);
    const optionId = await ctx.db.insert("modifierOptions", {
      organizationId: staff.organizationId,
      modifierGroupId: groupId,
      name,
      priceExtraCents,
      sortOrder: i,
      isActive: true,
    });
    if (raw.inventoryItemId) {
      const inv = await ctx.db.get("inventoryItems", raw.inventoryItemId);
      if (!inv || inv.organizationId !== staff.organizationId) {
        throw new ConvexError("El insumo del modificador no pertenece a tu restaurante.");
      }
      const delta = safeInteger(raw.quantityDeltaMicros ?? 0, "Consumo de insumo", 1);
      await ctx.db.insert("modifierRecipeIngredients", {
        organizationId: staff.organizationId,
        modifierOptionId: optionId,
        inventoryItemId: inv._id,
        quantityDeltaMicros: delta,
      });
    }
  }
}

export const createModifierGroup = mutation({
  args: {
    name: v.string(),
    required: v.boolean(),
    multi: v.boolean(),
    options: v.array(modifierOptionInput),
  },
  returns: v.id("modifierGroups"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre del grupo", 80);
    const existing = await ctx.db
      .query("modifierGroups")
      .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
      .take(100);
    if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      throw new ConvexError("Ya existe un grupo de modificadores con ese nombre.");
    }
    const sortOrder = Math.max(0, ...existing.map((g) => g.sortOrder)) + 1;
    const groupId = await ctx.db.insert("modifierGroups", {
      organizationId: staff.organizationId,
      name,
      minSelections: args.required ? 1 : 0,
      maxSelections: args.multi ? undefined : 1,
      sortOrder,
      isActive: true,
    });
    await replaceModifierOptions(ctx, staff, groupId, args.options);
    return groupId;
  },
});

export const updateModifierGroup = mutation({
  args: {
    groupId: v.id("modifierGroups"),
    name: v.string(),
    required: v.boolean(),
    multi: v.boolean(),
    options: v.array(modifierOptionInput),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const group = await ctx.db.get("modifierGroups", args.groupId);
    if (!group || group.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese grupo de modificadores.");
    }
    const name = requiredText(args.name, "Nombre del grupo", 80);
    const existing = await ctx.db
      .query("modifierGroups")
      .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
      .take(100);
    if (existing.some((g) => g._id !== group._id && g.name.toLowerCase() === name.toLowerCase())) {
      throw new ConvexError("Ya existe un grupo de modificadores con ese nombre.");
    }
    await ctx.db.patch("modifierGroups", group._id, {
      name,
      minSelections: args.required ? 1 : 0,
      maxSelections: args.multi ? undefined : 1,
    });
    await replaceModifierOptions(ctx, staff, group._id, args.options);
    return null;
  },
});

export const removeModifierGroup = mutation({
  args: { groupId: v.id("modifierGroups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const group = await ctx.db.get("modifierGroups", args.groupId);
    if (!group || group.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese grupo de modificadores.");
    }
    const [links, options] = await Promise.all([
      ctx.db
        .query("dishModifierGroups")
        .withIndex("by_modifierGroupId", (q) => q.eq("modifierGroupId", group._id))
        .take(200),
      ctx.db
        .query("modifierOptions")
        .withIndex("by_modifierGroupId_and_name", (q) => q.eq("modifierGroupId", group._id))
        .take(50),
    ]);
    for (const link of links) await ctx.db.delete("dishModifierGroups", link._id);
    for (const opt of options) {
      const recs = await ctx.db
        .query("modifierRecipeIngredients")
        .withIndex("by_modifierOptionId_and_inventoryItemId", (q) => q.eq("modifierOptionId", opt._id))
        .take(20);
      for (const r of recs) await ctx.db.delete("modifierRecipeIngredients", r._id);
      await ctx.db.delete("modifierOptions", opt._id);
    }
    await ctx.db.delete("modifierGroups", group._id);
    return null;
  },
});
