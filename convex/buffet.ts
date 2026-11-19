import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import { buffetBatchIngredients } from "./model/inventory";
import { emitNotification } from "./model/notifications";
import { ensureStationForArea, resolveDishAreas } from "./model/orders";
import { preparationArea, preparationStatus, serviceMode } from "./model/validators";
import { todayIsoDate } from "../lib/format";
import { locationPreparationAreas, PREPARATION_AREA_META } from "../lib/restaurant-roles";

const EDITORS = ["owner", "manager"] as const;
const SERVICE_ROLES = [...EDITORS, "waiter"] as const;
const DEFAULT_DESTINATION = "Línea de buffet";

const dishSettings = v.array(v.object({
  dishId: v.id("dishes"), destination: v.string(), portionsPerTray: v.number(),
}));

async function editor(ctx: MutationCtx | QueryCtx) {
  return await requireStaff(ctx, undefined, undefined, EDITORS);
}

function validDate(value: string) {
  const clean = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new ConvexError("Fecha del menú: usa el formato AAAA-MM-DD.");
  }
  return clean;
}

const buffetDishView = v.object({
  dishId: v.id("dishes"),
  name: v.string(),
  categoryName: v.union(v.string(), v.null()),
  priceCents: v.number(),
  photoUrl: v.union(v.string(), v.null()),
  sortOrder: v.number(),
  destination: v.string(),
  portionsPerTray: v.number(),
});

const buffetMenuView = v.object({
  _id: v.id("buffetMenus"),
  _creationTime: v.number(),
  name: v.string(),
  menuDate: v.string(),
  isActive: v.boolean(),
  dishes: v.array(buffetDishView),
});

export const snapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    timeZone: v.string(),
    serviceMode,
    menus: v.array(buffetMenuView),
    availableDishes: v.array(
      v.object({
        _id: v.id("dishes"),
        name: v.string(),
        categoryName: v.union(v.string(), v.null()),
        priceCents: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const [restaurant, location, menus, dishes, categories] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("buffetMenus")
        .withIndex("by_locationId_and_menuDate", (q) => q.eq("locationId", staff.locationId))
        .order("desc")
        .take(50),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(200),
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
    ]);

    const categoryMap = new Map(categories.map((c) => [c._id, c.name] as const));
    const dishMap = new Map(dishes.map((d) => [d._id, d] as const));

    const menuViews = await Promise.all(
      menus.map(async (menu) => {
        const links = await ctx.db
          .query("buffetMenuDishes")
          .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", menu._id))
          .take(100);
        const hydrated = await Promise.all(
          links
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(async (link) => {
              const dish = dishMap.get(link.dishId);
              if (!dish) return null;
              const photoUrl = dish.photoId ? await ctx.storage.getUrl(dish.photoId) : null;
              return {
                dishId: dish._id,
                name: dish.name,
                categoryName: dish.categoryId ? categoryMap.get(dish.categoryId) ?? null : null,
                priceCents: dish.priceCents,
                photoUrl,
                sortOrder: link.sortOrder,
                destination: link.destination ?? DEFAULT_DESTINATION,
                portionsPerTray: link.portionsPerTray ?? 1,
              };
            }),
        );
        return {
          _id: menu._id,
          _creationTime: menu._creationTime,
          name: menu.name,
          menuDate: menu.menuDate,
          isActive: menu.isActive,
          dishes: hydrated.filter((d): d is NonNullable<typeof d> => d !== null),
        };
      }),
    );

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      timeZone: location?.timeZone ?? "America/Mexico_City",
      serviceMode: location?.serviceMode ?? "mixed",
      menus: menuViews,
      availableDishes: dishes.map((dish) => ({
        _id: dish._id,
        name: dish.name,
        categoryName: dish.categoryId ? categoryMap.get(dish.categoryId) ?? null : null,
        priceCents: dish.priceCents,
      })),
    };
  },
});

async function syncMenuDishes(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  buffetMenuId: Id<"buffetMenus">,
  dishIds: Id<"dishes">[],
  settings: typeof dishSettings.type | undefined,
) {
  const existing = await ctx.db
    .query("buffetMenuDishes")
    .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", buffetMenuId))
    .take(100);
  const uniqueIds = [...new Set(dishIds)].slice(0, 80);
  const selected = new Set(uniqueIds);
  const existingByDish = new Map(existing.map((row) => [row.dishId, row]));
  const settingsByDish = new Map(settings?.map((row) => [row.dishId, row]));
  for (const row of existing) {
    if (!selected.has(row.dishId)) await ctx.db.delete("buffetMenuDishes", row._id);
  }
  for (let i = 0; i < uniqueIds.length; i++) {
    const dishId = uniqueIds[i];
    const dish = await ctx.db.get("dishes", dishId);
    if (!dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("Uno de los platillos seleccionados no pertenece a tu restaurante.");
    }
    const previous = existingByDish.get(dishId);
    const option = settingsByDish.get(dishId);
    const fields = {
      sortOrder: i,
      destination: option ? requiredText(option.destination, "Estación del buffet", 60) : previous?.destination,
      portionsPerTray: option ? safeInteger(option.portionsPerTray, "Porciones por bandeja", 1) : previous?.portionsPerTray,
    };
    if (previous) {
      await ctx.db.patch("buffetMenuDishes", previous._id, fields);
    } else {
      await ctx.db.insert("buffetMenuDishes", {
        organizationId: staff.organizationId, locationId: staff.locationId, buffetMenuId, dishId, ...fields,
      });
    }
  }
}

export const createMenu = mutation({
  args: {
    name: v.string(),
    menuDate: v.string(),
    isActive: v.boolean(),
    dishIds: v.array(v.id("dishes")),
    dishSettings: v.optional(dishSettings),
  },
  returns: v.id("buffetMenus"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre del menú de buffet", 100);
    const menuDate = validDate(args.menuDate);
    const menuId = await ctx.db.insert("buffetMenus", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      name,
      menuDate,
      isActive: args.isActive,
    });
    await syncMenuDishes(ctx, staff, menuId, args.dishIds, args.dishSettings);
    return menuId;
  },
});

export const updateMenu = mutation({
  args: {
    menuId: v.id("buffetMenus"),
    name: v.string(),
    menuDate: v.string(),
    isActive: v.boolean(),
    dishIds: v.array(v.id("dishes")),
    dishSettings: v.optional(dishSettings),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const menu = await ctx.db.get("buffetMenus", args.menuId);
    if (!menu || menu.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese menú de buffet.");
    }
    const name = requiredText(args.name, "Nombre del menú de buffet", 100);
    const menuDate = validDate(args.menuDate);
    await ctx.db.patch("buffetMenus", menu._id, {
      name,
      menuDate,
      isActive: args.isActive,
    });
    await syncMenuDishes(ctx, staff, menu._id, args.dishIds, args.dishSettings);
    return null;
  },
});

export const toggleMenuActive = mutation({
  args: { menuId: v.id("buffetMenus") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const menu = await ctx.db.get("buffetMenus", args.menuId);
    if (!menu || menu.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese menú de buffet.");
    }
    await ctx.db.patch("buffetMenus", menu._id, { isActive: !menu.isActive });
    return null;
  },
});

export const removeMenu = mutation({
  args: { menuId: v.id("buffetMenus") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const menu = await ctx.db.get("buffetMenus", args.menuId);
    if (!menu || menu.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese menú de buffet.");
    }
    const links = await ctx.db
      .query("buffetMenuDishes")
      .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", menu._id))
      .take(100);
    for (const link of links) {
      await ctx.db.delete("buffetMenuDishes", link._id);
    }
    await ctx.db.delete("buffetMenus", menu._id);
    return null;
  },
});

export const replenishmentView = v.object({
  _id: v.id("buffetBatches"),
  dishId: v.id("dishes"),
  dishName: v.string(),
  destination: v.string(),
  area: preparationArea,
  portions: v.number(),
  status: preparationStatus,
  requestedAt: v.number(),
  updatedAt: v.number(),
});

function destinationKey(destination: string) {
  return destination.normalize("NFKC").toLocaleLowerCase("es-MX").replace(/\s+/g, " ");
}

function replenishmentArea(dish: Doc<"dishes">, location: Doc<"locations">) {
  const enabledAreas = locationPreparationAreas(location.enabledPreparationAreas);
  return resolveDishAreas(dish).find((area) => enabledAreas.includes(area));
}

export const hasOpenReplenishments = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, undefined, undefined, SERVICE_ROLES);
    const batch = await ctx.db.query("buffetBatches")
      .withIndex("by_locationId_and_replenishment_isOpen_and_updatedAt", (q) =>
        q.eq("locationId", staff.locationId).eq("replenishment.isOpen", true))
      .first();
    return batch !== null;
  },
});

export async function listReplenishments(ctx: QueryCtx, locationId: Id<"locations">, isOpen: boolean) {
  const batches = await ctx.db
    .query("buffetBatches")
    .withIndex("by_locationId_and_replenishment_isOpen_and_updatedAt", (q) =>
      q.eq("locationId", locationId).eq("replenishment.isOpen", isOpen))
    .order(isOpen ? "asc" : "desc")
    .take(isOpen ? 200 : 15);
  return batches.flatMap((batch) => {
    if (!batch.replenishment) return [];
    return [{
      _id: batch._id,
      dishId: batch.dishId,
      dishName: batch.replenishment.dishName,
      destination: batch.replenishment.destination,
      area: batch.replenishment.area,
      portions: batch.portions,
      status: batch.status,
      requestedAt: batch._creationTime,
      updatedAt: batch.updatedAt,
    }];
  });
}

export const serviceSnapshot = query({
  args: { menuDate: v.string() },
  returns: v.object({
    enabled: v.boolean(),
    menus: v.array(v.object({
      _id: v.id("buffetMenus"), name: v.string(),
      dishes: v.array(v.object({
        _id: v.id("dishes"), name: v.string(), destination: v.string(), portions: v.number(),
        area: v.union(preparationArea, v.null()), hasOpenRequest: v.boolean(),
      })),
    })),
    active: v.array(replenishmentView),
    recent: v.array(replenishmentView),
  }),
  handler: async (ctx, { menuDate }) => {
    const staff = await requireStaff(ctx, undefined, undefined, SERVICE_ROLES);
    const [location, active, recent] = await Promise.all([
      ctx.db.get("locations", staff.locationId),
      listReplenishments(ctx, staff.locationId, true),
      listReplenishments(ctx, staff.locationId, false),
    ]);
    if (!location || location.serviceMode === "a_la_carte") {
      return { enabled: false, menus: [], active, recent };
    }
    const menus = await ctx.db.query("buffetMenus")
      .withIndex("by_locationId_and_isActive_and_menuDate", (q) =>
        q.eq("locationId", staff.locationId).eq("isActive", true).eq("menuDate", validDate(menuDate)))
      .take(50);
    const openKeys = new Set(active.map((row) => `${row.dishId}:${destinationKey(row.destination)}`));
    const menuViews = await Promise.all(menus.map(async (menu) => {
      const links = await ctx.db.query("buffetMenuDishes")
        .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", menu._id))
        .take(80);
      const dishes = await Promise.all(links.sort((a, b) => a.sortOrder - b.sortOrder).map(async (link) => {
        const dish = await ctx.db.get("dishes", link.dishId);
        if (!dish || dish.organizationId !== staff.organizationId) return null;
        const destination = link.destination ?? DEFAULT_DESTINATION;
        return {
          _id: dish._id,
          name: dish.name,
          destination,
          portions: link.portionsPerTray ?? 1,
          area: replenishmentArea(dish, location) ?? null,
          hasOpenRequest: openKeys.has(`${dish._id}:${destinationKey(destination)}`),
        };
      }));
      return { _id: menu._id, name: menu.name, dishes: dishes.filter((dish) => dish !== null) };
    }));
    return { enabled: true, menus: menuViews, active, recent };
  },
});

export const requestReplenishment = mutation({
  args: { menuId: v.id("buffetMenus"), dishId: v.id("dishes") },
  returns: v.object({ created: v.boolean(), batchId: v.id("buffetBatches") }),
  handler: async (ctx, { menuId, dishId }) => {
    const staff = await requireStaff(ctx, undefined, undefined, SERVICE_ROLES);
    const [location, menu, dish, link] = await Promise.all([
      ctx.db.get("locations", staff.locationId),
      ctx.db.get("buffetMenus", menuId),
      ctx.db.get("dishes", dishId),
      ctx.db.query("buffetMenuDishes")
        .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", menuId).eq("dishId", dishId))
        .unique(),
    ]);
    if (!location || location.serviceMode === "a_la_carte") {
      throw new ConvexError("Activa el modo Buffet o Mixto para pedir reposiciones.");
    }
    const now = Date.now();
    if (!menu?.isActive || menu.locationId !== staff.locationId || menu.organizationId !== staff.organizationId ||
        menu.menuDate !== todayIsoDate(location.timeZone, new Date(now))) {
      throw new ConvexError("Ese menú de buffet ya no está activo para hoy.");
    }
    if (!link || link.locationId !== staff.locationId || link.organizationId !== staff.organizationId ||
        !dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("Ese platillo no está en el menú de buffet.");
    }

    const destination = link.destination ?? DEFAULT_DESTINATION;
    const key = destinationKey(destination);
    const existing = await ctx.db.query("buffetBatches")
      .withIndex("by_locationId_and_dishId_and_destinationKey_and_isOpen", (q) =>
        q.eq("locationId", staff.locationId).eq("dishId", dishId)
          .eq("replenishment.destinationKey", key).eq("replenishment.isOpen", true))
      .unique();
    if (existing) return { created: false, batchId: existing._id };

    const area = replenishmentArea(dish, location);
    if (!area) throw new ConvexError("Activa un área de preparación del platillo para pedirlo.");
    const stationId = await ensureStationForArea(ctx, staff, area);
    const batchId = await ctx.db.insert("buffetBatches", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      buffetMenuId: menuId,
      dishId,
      stationId,
      portions: link.portionsPerTray ?? 1,
      status: "ordered",
      updatedAt: now,
      replenishment: {
        dishName: dish.name,
        destination,
        destinationKey: key,
        area,
        isOpen: true,
        requestedByStaffId: staff._id,
      },
    });
    return { created: true, batchId };
  },
});

export const updateReplenishment = mutation({
  args: {
    batchId: v.id("buffetBatches"),
    status: v.union(v.literal("preparing"), v.literal("ready"), v.literal("delivered")),
  },
  returns: v.null(),
  handler: async (ctx, { batchId, status }) => {
    const batch = await ctx.db.get("buffetBatches", batchId);
    const request = batch?.replenishment;
    if (!batch || !request) throw new ConvexError("No encontramos esa reposición.");
    const roles = status === "delivered" ? SERVICE_ROLES : [...EDITORS, PREPARATION_AREA_META[request.area].role];
    const staff = await requireStaff(ctx, batch.organizationId, batch.locationId, roles);
    if (batch.status === status) return null;

    const now = Date.now();
    if (status === "delivered" && batch.status === "ready") {
      await ctx.db.patch("buffetBatches", batchId, {
        status,
        updatedAt: now,
        replenishment: { ...request, isOpen: false, replenishedByStaffId: staff._id },
      });
      return null;
    }
    if (status === "delivered" || (batch.status !== "ordered" && !(batch.status === "preparing" && status === "ready"))) {
      throw new ConvexError("La reposición cambió de estado. Revisa su estado actual.");
    }

    await ctx.db.patch("buffetBatches", batchId, {
      ...await buffetBatchIngredients(ctx, staff, batch, now),
      status,
      updatedAt: now,
      replenishment: status === "ready" ? { ...request, readyAt: now } : request,
    });
    if (status === "ready") {
      await emitNotification(ctx, {
        organizationId: staff.organizationId, locationId: staff.locationId, kind: "ready",
        title: `Buffet: ${request.dishName} listo para llevar`,
        body: `Lleva una bandeja a ${request.destination}.`,
        targetStaffId: request.requestedByStaffId,
        href: "/cuenta/buffet", actionLabel: "Ver reposición",
      });
    }
    return null;
  },
});
