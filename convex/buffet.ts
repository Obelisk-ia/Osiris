import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, requiredText } from "./model/access";

const EDITORS = ["owner", "manager"] as const;

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
    serviceMode: v.union(v.literal("a_la_carte"), v.literal("buffet"), v.literal("mixed")),
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
) {
  const existing = await ctx.db
    .query("buffetMenuDishes")
    .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", buffetMenuId))
    .take(100);
  for (const row of existing) {
    await ctx.db.delete("buffetMenuDishes", row._id);
  }
  const uniqueIds = [...new Set(dishIds)].slice(0, 80);
  for (let i = 0; i < uniqueIds.length; i++) {
    const dishId = uniqueIds[i];
    const dish = await ctx.db.get("dishes", dishId);
    if (!dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("Uno de los platillos seleccionados no pertenece a tu restaurante.");
    }
    await ctx.db.insert("buffetMenuDishes", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      buffetMenuId,
      dishId,
      sortOrder: i,
    });
  }
}

export const createMenu = mutation({
  args: {
    name: v.string(),
    menuDate: v.string(),
    isActive: v.boolean(),
    dishIds: v.array(v.id("dishes")),
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
    await syncMenuDishes(ctx, staff, menuId, args.dishIds);
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
    await syncMenuDishes(ctx, staff, menu._id, args.dishIds);
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
