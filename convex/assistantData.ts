import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canEditSharedMenu, locationPreparationAreas } from "../lib/restaurant-roles";
import {
  buffetBatchProposalSchema,
  convertQuantityToMicros,
  floorBatchProposalSchema,
  floorLayoutChangesProposalSchema,
  formatMicrosDisplay,
  inventoryBatchProposalSchema,
  inventoryEditsProposalSchema,
  inventoryReceiptProposalSchema,
  menuBatchProposalSchema,
  menuEditsProposalSchema,
  MICROS_PER_UNIT,
  normalizeNameKey,
  priceToCents,
  recipeBatchProposalSchema,
  sectionAssignmentsProposalSchema,
} from "../lib/assistant-proposals";
import { tableShape } from "./model/validators";

const ALLOWED_ROLES = new Set<string>(["owner", "manager"]);

export async function authorizeStaffById(
  ctx: QueryCtx | MutationCtx,
  staffId: Id<"staff">,
  requireMenuEdit = false,
): Promise<Doc<"staff">> {
  const staff = await ctx.db.get("staff", staffId);
  if (!staff?.isActive || !staff.roles.some((role) => ALLOWED_ROLES.has(role))) {
    throw new ConvexError("Solo dueños y gerentes pueden usar el asistente.");
  }
  if (requireMenuEdit && !canEditSharedMenu(staff)) {
    throw new ConvexError("Tu cuenta de gerente no tiene permiso para crear o editar el menú.");
  }
  return staff;
}

/* ───────── Read Queries ───────── */

export const getRestaurantContext = internalQuery({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const [organization, location] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
    ]);
    if (!organization || !location) {
      throw new ConvexError("No encontramos la sucursal o el restaurante.");
    }
    return {
      restaurantName: organization.name,
      currencyCode: organization.currencyCode,
      locationId: location._id,
      locationName: location.name,
      timeZone: location.timeZone,
      serviceMode: location.serviceMode,
      buffetTableService: location.buffetTableService ?? true,
      buffetPrices: location.buffetPrices ?? null,
      enabledPreparationAreas: locationPreparationAreas(location.enabledPreparationAreas),
      staffName: staff.displayName,
      roles: staff.roles,
      canEditMenu: canEditSharedMenu(staff),
    };
  },
});

export const listMenu = internalQuery({
  args: {
    staffId: v.id("staff"),
    categoryFilter: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, categoryFilter }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const [categories, dishes, modifierGroups, stations] = await Promise.all([
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(300),
      ctx.db
        .query("modifierGroups")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
      ctx.db
        .query("preparationStations")
        .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId))
        .take(50),
    ]);

    const categoryMap = new Map(categories.map((c) => [c._id, c.name] as const));
    const filterKey = categoryFilter ? normalizeNameKey(categoryFilter) : null;

    const filteredDishes = dishes
      .map((d) => ({
        id: d._id,
        name: d.name,
        description: d.description ?? "",
        price: Number((d.priceCents / 100).toFixed(2)),
        priceCents: d.priceCents,
        categoryName: d.categoryId ? (categoryMap.get(d.categoryId) ?? null) : null,
        areas: d.areas ?? (d.area === "barra" ? ["bar"] : ["kitchen"]),
        isAvailable: d.isAvailable,
        isPublished: d.isPublished ?? true,
        buffetExtra: d.buffetExtra ?? false,
      }))
      .filter((d) => !filterKey || (d.categoryName && normalizeNameKey(d.categoryName).includes(filterKey)));

    const groupsWithOptions = await Promise.all(
      modifierGroups.map(async (group) => {
        const options = await ctx.db
          .query("modifierOptions")
          .withIndex("by_modifierGroupId_and_name", (q) => q.eq("modifierGroupId", group._id))
          .take(50);
        return {
          id: group._id,
          name: group.name,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections ?? null,
          options: options.map((opt) => ({
            id: opt._id,
            name: opt.name,
            priceExtra: Number((opt.priceExtraCents / 100).toFixed(2)),
          })),
        };
      }),
    );

    return {
      categories: categories.map((c) => ({ id: c._id, name: c.name, isActive: c.isActive })),
      dishCount: filteredDishes.length,
      dishes: filteredDishes,
      modifierGroups: groupsWithOptions,
      stations: stations.map((s) => ({ id: s._id, name: s.name, role: s.role, area: s.area ?? null })),
    };
  },
});

export const listInventory = internalQuery({
  args: {
    staffId: v.id("staff"),
    onlyLowStock: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, onlyLowStock, search }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const [items, balances, suppliers] = await Promise.all([
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(300),
      ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(300),
      ctx.db
        .query("suppliers")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
    ]);

    const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));
    const supplierMap = new Map(suppliers.map((s) => [s._id, s.name] as const));
    const searchKey = search ? normalizeNameKey(search) : null;

    const mapped = items
      .map((item) => {
        const stockMicros = balanceMap.get(item._id) ?? 0;
        const minMicros =
          item.minMicros ??
          (item.maxMicros && item.maxMicros > 0
            ? Math.round((item.maxMicros * (item.thresholdPct ?? 20)) / 100)
            : 0);
        const status =
          stockMicros < 0
            ? "negative"
            : stockMicros === 0
              ? "out"
              : minMicros > 0 && stockMicros <= minMicros
                ? "low"
                : "normal";
        return {
          id: item._id,
          name: item.name,
          unit: item.unit,
          category: item.category ?? "",
          supplierName: item.supplierId ? (supplierMap.get(item.supplierId) ?? null) : null,
          presentation: item.presentation ?? "",
          stockDisplay: formatMicrosDisplay(stockMicros, item.unit),
          stockMicros,
          minDisplay: minMicros > 0 ? formatMicrosDisplay(minMicros, item.unit) : "Sin mínimo",
          lastCost: item.lastCostCents !== undefined ? Number((item.lastCostCents / 100).toFixed(2)) : null,
          status,
          isActive: item.isActive,
        };
      })
      .filter((item) => {
        if (onlyLowStock && item.status === "normal") return false;
        if (
          searchKey &&
          !normalizeNameKey(item.name).includes(searchKey) &&
          !normalizeNameKey(item.category).includes(searchKey)
        ) {
          return false;
        }
        return true;
      });

    return {
      totalItems: mapped.length,
      suppliers: suppliers.map((s) => ({ id: s._id, name: s.name, contact: s.contact ?? null })),
      items: mapped,
    };
  },
});

export const getFloorDistribution = internalQuery({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const [sections, tableTypes, tables, activeStaff] = await Promise.all([
      ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("tableTypes")
        .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("diningTables")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true))
        .take(150),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true))
        .take(80),
    ]);

    const sectionMap = new Map(sections.map((s) => [s._id, s.name] as const));
    const typeMap = new Map(tableTypes.map((t) => [t._id, t.name] as const));
    const staffNameMap = new Map(activeStaff.map((s) => [s._id, s.displayName] as const));
    const waiters = activeStaff
      .filter((member) => member.roles.includes("waiter"))
      .map((member) => ({ id: member._id, name: member.displayName }));

    const sectionViews = await Promise.all(
      sections.map(async (s) => {
        const secTables = tables.filter((t) => t.sectionId === s._id);
        const latestAssignment = await ctx.db
          .query("sectionAssignments")
          .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", s._id))
          .order("desc")
          .first();
        const assignedStaffId =
          latestAssignment && latestAssignment.endsAt === undefined
            ? latestAssignment.assignedStaffId
            : null;
        return {
          id: s._id,
          name: s.name,
          description: s.description ?? "",
          canvas: s.canvas,
          tableCount: secTables.length,
          seatCount: secTables.reduce((sum, t) => sum + t.seatCount, 0),
          assignedWaiterName: assignedStaffId ? (staffNameMap.get(assignedStaffId) ?? null) : null,
        };
      }),
    );

    return {
      totalSections: sections.length,
      totalTables: tables.length,
      totalSeats: tables.reduce((sum, t) => sum + t.seatCount, 0),
      waiters,
      sections: sectionViews,
      tableTypes: tableTypes.map((t) => ({
        id: t._id,
        name: t.name,
        shape: t.shape,
        seatCount: t.seatCount,
      })),
      tables: tables.map((t) => ({
        id: t._id,
        tableNumber: t.tableNumber,
        sectionId: t.sectionId,
        sectionName: sectionMap.get(t.sectionId) ?? "",
        tableTypeName: t.tableTypeId ? (typeMap.get(t.tableTypeId) ?? null) : null,
        seatCount: t.seatCount,
        shape: t.shape,
        status: t.status,
        xPct: t.canvas.x,
        yPct: t.canvas.y,
      })),
    };
  },
});

function costBasisMicrosFor(item: Doc<"inventoryItems">): number {
  if (item.factorMicros && item.factorMicros > MICROS_PER_UNIT) {
    return item.factorMicros;
  }
  if (item.unit === "g" || item.unit === "ml") {
    return 1000 * MICROS_PER_UNIT; // lastCostCents defaults to per kg / per L
  }
  return MICROS_PER_UNIT;
}

export const getMenuMargins = internalQuery({
  args: {
    staffId: v.id("staff"),
    maxMarginPct: v.optional(v.number()),
    categoryFilter: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, maxMarginPct, categoryFilter }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const [org, categories, dishes, invItems] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(200),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
    ]);

    const catMap = new Map(categories.map((c) => [c._id, c.name] as const));
    const invMap = new Map(invItems.map((i) => [i._id, i] as const));
    const filterKey = categoryFilter ? normalizeNameKey(categoryFilter) : null;

    const results = await Promise.all(
      dishes.map(async (dish) => {
        const categoryName = dish.categoryId ? (catMap.get(dish.categoryId) ?? null) : null;
        if (filterKey && (!categoryName || !normalizeNameKey(categoryName).includes(filterKey))) {
          return null;
        }
        const recipes = await ctx.db
          .query("recipeIngredients")
          .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
          .take(60);

        let costCents = 0;
        const missingCostIngredients: string[] = [];
        const breakdown: Array<{
          ingredient: string;
          quantity: string;
          cost: number | null;
        }> = [];

        for (const rec of recipes) {
          const item = invMap.get(rec.inventoryItemId);
          if (!item) continue;
          const qtyDisplay = formatMicrosDisplay(rec.quantityMicros, item.unit);
          if (item.lastCostCents !== undefined && item.lastCostCents > 0) {
            const basis = costBasisMicrosFor(item);
            const ingCostCents = (rec.quantityMicros / basis) * item.lastCostCents;
            costCents += ingCostCents;
            breakdown.push({
              ingredient: item.name,
              quantity: qtyDisplay,
              cost: Number((ingCostCents / 100).toFixed(2)),
            });
          } else {
            missingCostIngredients.push(item.name);
            breakdown.push({
              ingredient: item.name,
              quantity: qtyDisplay,
              cost: null,
            });
          }
        }

        const price = Number((dish.priceCents / 100).toFixed(2));
        const recipeCost = Number((costCents / 100).toFixed(2));
        const hasRecipe = recipes.length > 0;
        const grossProfit = hasRecipe ? Number((price - recipeCost).toFixed(2)) : null;
        const marginPct =
          hasRecipe && dish.priceCents > 0
            ? Number((((dish.priceCents - costCents) / dish.priceCents) * 100).toFixed(1))
            : null;
        const foodCostPct =
          hasRecipe && dish.priceCents > 0
            ? Number(((costCents / dish.priceCents) * 100).toFixed(1))
            : null;

        if (maxMarginPct !== undefined && (marginPct === null || marginPct > maxMarginPct)) {
          return null;
        }

        return {
          dishName: dish.name,
          categoryName,
          price,
          hasRecipe,
          recipeCost: hasRecipe ? recipeCost : null,
          grossProfit,
          marginPct,
          foodCostPct,
          missingCostIngredients,
          ingredients: breakdown,
        };
      }),
    );

    const rows = results.filter((r) => r !== null);
    return {
      currencyCode: org?.currencyCode ?? "MXN",
      analyzedDishes: rows.length,
      dishes: rows,
    };
  },
});

export const getSalesAndShiftSummary = internalQuery({
  args: {
    staffId: v.id("staff"),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, { staffId, daysBack }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const days = Math.max(1, Math.min(30, Math.round(daysBack ?? 1)));
    const now = Date.now();
    const since = now - days * 24 * 60 * 60 * 1000;

    const [org, payments, shifts, recentOrders] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db
        .query("payments")
        .withIndex("by_locationId_and_createdAt", (q) =>
          q.eq("locationId", staff.locationId).gte("createdAt", since),
        )
        .order("desc")
        .take(500),
      ctx.db
        .query("cashShifts")
        .withIndex("by_locationId_and_openedAt", (q) =>
          q.eq("locationId", staff.locationId).gte("openedAt", since),
        )
        .order("desc")
        .take(40),
      ctx.db
        .query("orders")
        .withIndex("by_locationId_and_status", (q) => q.eq("locationId", staff.locationId))
        .order("desc")
        .take(250),
    ]);

    const byMethod: Record<string, { count: number; amountCents: number; tipCents: number }> = {
      efectivo: { count: 0, amountCents: 0, tipCents: 0 },
      tarjeta: { count: 0, amountCents: 0, tipCents: 0 },
      transferencia: { count: 0, amountCents: 0, tipCents: 0 },
      vales: { count: 0, amountCents: 0, tipCents: 0 },
    };

    let totalSalesCents = 0;
    let totalTipsCents = 0;
    let confirmedCount = 0;
    let revertedCount = 0;

    for (const p of payments) {
      if (p.status === "reverted") {
        revertedCount++;
        continue;
      }
      confirmedCount++;
      totalSalesCents += p.amountCents;
      totalTipsCents += p.tipCents;
      const bucket = byMethod[p.method] ?? { count: 0, amountCents: 0, tipCents: 0 };
      bucket.count++;
      bucket.amountCents += p.amountCents;
      bucket.tipCents += p.tipCents;
      byMethod[p.method] = bucket;
    }

    const shiftSummaries = shifts.map((s) => {
      const varianceCents =
        s.closedAt !== undefined &&
        s.countedCashCents !== undefined &&
        s.expectedCashCents !== undefined
          ? s.countedCashCents - s.expectedCashCents
          : null;
      return {
        isOpen: s.closedAt === undefined,
        openedAt: new Date(s.openedAt).toISOString(),
        closedAt: s.closedAt ? new Date(s.closedAt).toISOString() : null,
        fund: Number((s.fundCents / 100).toFixed(2)),
        expectedCash:
          s.expectedCashCents !== undefined ? Number((s.expectedCashCents / 100).toFixed(2)) : null,
        countedCash:
          s.countedCashCents !== undefined ? Number((s.countedCashCents / 100).toFixed(2)) : null,
        variance: varianceCents !== null ? Number((varianceCents / 100).toFixed(2)) : null,
      };
    });

    const ordersInWindow = recentOrders.filter((o) => o._creationTime >= since);
    const dishTotals = new Map<string, { quantity: number; revenueCents: number }>();
    let cancelledItems = 0;
    const cancelReasons: Record<string, number> = {};

    for (const order of ordersInWindow.slice(0, 120)) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(50);
      for (const item of items) {
        if (item.status === "cancelled" || item.cancelledAt) {
          cancelledItems += item.quantity;
          const reason = item.cancelReason?.trim() || "Sin motivo";
          cancelReasons[reason] = (cancelReasons[reason] ?? 0) + item.quantity;
          continue;
        }
        const entry = dishTotals.get(item.dishName) ?? { quantity: 0, revenueCents: 0 };
        entry.quantity += item.quantity;
        entry.revenueCents += item.unitPriceCents * item.quantity;
        dishTotals.set(item.dishName, entry);
      }
    }

    const topDishes = Array.from(dishTotals.entries())
      .map(([dishName, stat]) => ({
        dishName,
        quantity: stat.quantity,
        revenue: Number((stat.revenueCents / 100).toFixed(2)),
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    return {
      currencyCode: org?.currencyCode ?? "MXN",
      daysBack: days,
      totalSales: Number((totalSalesCents / 100).toFixed(2)),
      totalTips: Number((totalTipsCents / 100).toFixed(2)),
      confirmedPayments: confirmedCount,
      revertedPayments: revertedCount,
      byPaymentMethod: Object.entries(byMethod).map(([method, stat]) => ({
        method,
        count: stat.count,
        amount: Number((stat.amountCents / 100).toFixed(2)),
        tips: Number((stat.tipCents / 100).toFixed(2)),
      })),
      shiftsCount: shifts.length,
      shifts: shiftSummaries,
      ordersAnalyzed: ordersInWindow.length,
      topDishes,
      cancelledItems,
      cancelReasons,
    };
  },
});

export const listBuffetMenus = internalQuery({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const staff = await authorizeStaffById(ctx, staffId);
    const [location, menus] = await Promise.all([
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("buffetMenus")
        .withIndex("by_locationId_and_menuDate", (q) => q.eq("locationId", staff.locationId))
        .order("desc")
        .take(30),
    ]);

    const menuViews = await Promise.all(
      menus.map(async (menu) => {
        const links = await ctx.db
          .query("buffetMenuDishes")
          .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", menu._id))
          .take(80);
        const dishes = await Promise.all(
          links
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(async (link) => {
              const dish = await ctx.db.get("dishes", link.dishId);
              return dish
                ? {
                    dishId: dish._id,
                    name: dish.name,
                    destination: link.destination ?? "Línea de buffet",
                    portionsPerTray: link.portionsPerTray ?? 12,
                  }
                : null;
            }),
        );
        return {
          id: menu._id,
          name: menu.name,
          menuDate: menu.menuDate,
          isActive: menu.isActive,
          dishes: dishes.filter((d) => d !== null),
        };
      }),
    );

    return {
      serviceMode: location?.serviceMode ?? "a_la_carte",
      buffetPrices: location?.buffetPrices ?? null,
      menus: menuViews,
    };
  },
});

/* ───────── Layout Placement Helpers ───────── */

function nextSectionCanvas(existing: Doc<"sections">[]) {
  if (existing.length === 0) {
    return { x: 2, y: 2, width: 96, height: 42, rotation: 0 };
  }
  const maxBottom = existing.reduce((max, s) => Math.max(max, s.canvas.y + s.canvas.height), 0);
  const y = Math.min(940, Math.round((maxBottom + 4) * 10) / 10);
  return { x: 2, y, width: 96, height: 42, rotation: 0 };
}

function findNextFreeTablePositions(
  existingTables: Array<{ canvas: { x: number; y: number } }>,
  count: number,
): Array<{ x: number; y: number }> {
  const occupied = existingTables.map((t) => ({ x: t.canvas.x, y: t.canvas.y }));
  const cols = [16, 33, 50, 67, 84];
  const rows = [22, 46, 70, 84];
  const positions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    let chosen: { x: number; y: number } | null = null;
    for (const y of rows) {
      for (const x of cols) {
        const tooClose = occupied.some((o) => Math.hypot(o.x - x, o.y - y) < 12);
        if (!tooClose) {
          chosen = { x, y };
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) {
      const idx = occupied.length;
      const x = 14 + ((idx * 15) % 74);
      const y = 18 + ((Math.floor(idx / 5) * 18) % 66);
      chosen = { x: Math.min(90, Math.max(10, x)), y: Math.min(86, Math.max(14, y)) };
    }
    occupied.push(chosen);
    positions.push(chosen);
  }
  return positions;
}

/* ───────── Direct Small Additive Mutations ───────── */

export const createSectionDirect = internalMutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await authorizeStaffById(ctx, args.staffId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("El nombre de la sección es obligatorio.");

    const existing = await ctx.db
      .query("sections")
      .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
      .take(50);

    const dup = existing.find((s) => normalizeNameKey(s.name) === normalizeNameKey(name));
    if (dup) {
      return { id: dup._id, name: dup.name, alreadyExisted: true };
    }

    const sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
    const id = await ctx.db.insert("sections", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      name,
      description: args.description?.trim() || undefined,
      sortOrder,
      canvas: nextSectionCanvas(existing),
    });
    return { id, name, alreadyExisted: false };
  },
});

export const createTableTypeDirect = internalMutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
    shape: tableShape,
    seatCount: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await authorizeStaffById(ctx, args.staffId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("El nombre del tipo de mesa es obligatorio.");

    const existing = await ctx.db
      .query("tableTypes")
      .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId))
      .take(50);
    const dup = existing.find((t) => normalizeNameKey(t.name) === normalizeNameKey(name));
    if (dup) {
      return { id: dup._id, name: dup.name, alreadyExisted: true };
    }

    const id = await ctx.db.insert("tableTypes", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      name,
      shape: args.shape,
      seatCount: Math.max(1, Math.min(30, Math.round(args.seatCount))),
      isActive: true,
    });
    return { id, name, alreadyExisted: false };
  },
});

export const createTablesDirect = internalMutation({
  args: {
    staffId: v.id("staff"),
    sectionName: v.string(),
    tables: v.array(
      v.object({
        tableNumber: v.string(),
        seatCount: v.number(),
        shape: tableShape,
        tableTypeName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const staff = await authorizeStaffById(ctx, args.staffId);
    if (args.tables.length === 0 || args.tables.length > 10) {
      throw new ConvexError("Usa propuestas para crear más de 10 mesas a la vez.");
    }

    const sections = await ctx.db
      .query("sections")
      .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
      .take(50);
    let section = sections.find((s) => normalizeNameKey(s.name) === normalizeNameKey(args.sectionName));
    if (!section) {
      const sortOrder = sections.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
      const sectionId = await ctx.db.insert("sections", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        name: args.sectionName.trim().slice(0, 80),
        sortOrder,
        canvas: nextSectionCanvas(sections),
      });
      section = (await ctx.db.get("sections", sectionId))!;
    }

    const [existingTables, tableTypes] = await Promise.all([
      ctx.db
        .query("diningTables")
        .withIndex("by_sectionId_and_tableNumber", (q) => q.eq("sectionId", section._id))
        .take(100),
      ctx.db
        .query("tableTypes")
        .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId))
        .take(50),
    ]);

    const existingNumbers = new Set(existingTables.map((t) => normalizeNameKey(t.tableNumber)));
    const typeByKey = new Map(tableTypes.map((t) => [normalizeNameKey(t.name), t] as const));

    const toCreate = args.tables.filter((t) => !existingNumbers.has(normalizeNameKey(t.tableNumber)));
    const positions = findNextFreeTablePositions(existingTables, toCreate.length);

    const created: Array<{ id: Id<"diningTables">; tableNumber: string }> = [];
    for (let i = 0; i < toCreate.length; i++) {
      const item = toCreate[i];
      const pos = positions[i];
      const matchedType = item.tableTypeName ? typeByKey.get(normalizeNameKey(item.tableTypeName)) : undefined;
      const id = await ctx.db.insert("diningTables", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        sectionId: section._id,
        tableTypeId: matchedType?._id,
        tableNumber: item.tableNumber.trim().slice(0, 40),
        seatCount: matchedType?.seatCount ?? Math.max(1, Math.min(30, Math.round(item.seatCount))),
        shape: matchedType?.shape ?? item.shape,
        canvas: {
          x: pos.x,
          y: pos.y,
          width: section.canvas.width,
          height: section.canvas.height,
          rotation: 0,
        },
        status: "empty",
        isActive: true,
        qrToken: crypto.randomUUID(),
        qrEnabled: true,
        qrCreatedAt: Date.now(),
        qrVersion: 1,
      });
      created.push({ id, tableNumber: item.tableNumber.trim() });
    }

    return {
      sectionName: section.name,
      createdCount: created.length,
      skippedDuplicates: args.tables.length - created.length,
      created,
    };
  },
});

export const createSuppliersDirect = internalMutation({
  args: {
    staffId: v.id("staff"),
    suppliers: v.array(v.object({ name: v.string(), contact: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const staff = await authorizeStaffById(ctx, args.staffId);
    const existing = await ctx.db
      .query("suppliers")
      .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
      .take(150);
    const byKey = new Set(existing.map((s) => normalizeNameKey(s.name)));

    let created = 0;
    let skipped = 0;
    for (const sup of args.suppliers) {
      const name = sup.name.trim().slice(0, 100);
      if (!name || byKey.has(normalizeNameKey(name))) {
        skipped++;
        continue;
      }
      await ctx.db.insert("suppliers", {
        organizationId: staff.organizationId,
        name,
        contact: sup.contact?.trim() || undefined,
        isActive: true,
      });
      byKey.add(normalizeNameKey(name));
      created++;
    }
    return { created, skipped };
  },
});

export const createDishCategoryDirect = internalMutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await authorizeStaffById(ctx, args.staffId, true);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("El nombre de la categoría es obligatorio.");

    const existing = await ctx.db
      .query("dishCategories")
      .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
      .take(100);
    const dup = existing.find((c) => normalizeNameKey(c.name) === normalizeNameKey(name));
    if (dup) return { id: dup._id, name: dup.name, alreadyExisted: true };

    const sortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
    const id = await ctx.db.insert("dishCategories", {
      organizationId: staff.organizationId,
      name,
      sortOrder,
      isActive: true,
    });
    return { id, name, alreadyExisted: false };
  },
});

export const createBuffetMenuDirect = internalMutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
    menuDate: v.string(),
    dishNames: v.array(v.string()),
    destination: v.optional(v.string()),
    portionsPerTray: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const staff = await authorizeStaffById(ctx, args.staffId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.menuDate.trim())) {
      throw new ConvexError("Usa formato AAAA-MM-DD para la fecha del menú de buffet.");
    }
    const menuId = await ctx.db.insert("buffetMenus", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      name: args.name.trim().slice(0, 100),
      menuDate: args.menuDate.trim(),
      isActive: true,
    });

    const dishes = await ctx.db
      .query("dishes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
      .take(300);
    const dishByKey = new Map(dishes.map((d) => [normalizeNameKey(d.name), d] as const));

    let linked = 0;
    const notFound: string[] = [];
    for (let i = 0; i < args.dishNames.length; i++) {
      const targetName = args.dishNames[i];
      const dish = dishByKey.get(normalizeNameKey(targetName));
      if (!dish) {
        notFound.push(targetName);
        continue;
      }
      await ctx.db.insert("buffetMenuDishes", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        buffetMenuId: menuId,
        dishId: dish._id,
        sortOrder: i + 1,
        destination: args.destination?.trim() || "Línea de buffet",
        portionsPerTray: Math.max(1, Math.round(args.portionsPerTray ?? 12)),
      });
      linked++;
    }
    return { menuId, linkedDishes: linked, notFoundDishes: notFound };
  },
});

/* ───────── Two-Phase Proposal System (Preview → Confirm & Create) ───────── */

export const createProposal = internalMutation({
  args: {
    staffId: v.id("staff"),
    threadId: v.string(),
    kind: v.union(
      v.literal("menu_batch"),
      v.literal("menu_edits"),
      v.literal("inventory_batch"),
      v.literal("inventory_edits"),
      v.literal("inventory_receipt"),
      v.literal("buffet_batch"),
      v.literal("floor_batch"),
      v.literal("floor_layout_changes"),
      v.literal("section_assignments"),
      v.literal("recipe_batch"),
    ),
    title: v.string(),
    summary: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const requireMenuEdit =
      args.kind === "menu_batch" || args.kind === "menu_edits" || args.kind === "recipe_batch";
    const staff = await authorizeStaffById(ctx, args.staffId, requireMenuEdit);
    const proposalId = await ctx.db.insert("assistantProposals", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      threadId: args.threadId,
      createdByStaffId: staff._id,
      status: "pending",
      kind: args.kind,
      title: args.title.trim().slice(0, 140),
      summary: args.summary.trim().slice(0, 400),
      payload: args.payload,
    });
    return { proposalId };
  },
});

async function ensureInventoryItemWithSample(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  invByKey: Map<string, Doc<"inventoryItems">>,
  rawName: string,
  rawUnit: string,
  recipeMicros: number,
  proposalId: Id<"assistantProposals">,
  autoCreatedNotes: string[],
): Promise<{ item: Doc<"inventoryItems">; unit: "g" | "ml" | "each"; micros: number }> {
  const cleanName = rawName.trim().slice(0, 100);
  const key = normalizeNameKey(cleanName);
  const converted = convertQuantityToMicros(1, rawUnit);
  const existing = invByKey.get(key);
  if (existing) {
    return { item: existing, unit: converted.unit, micros: recipeMicros };
  }

  // Create a small starter sample in inventory so the recipe can be linked and
  // the dish is immediately usable until the owner enters real stock & cost.
  const defaultSample =
    converted.unit === "g"
      ? 500 * MICROS_PER_UNIT
      : converted.unit === "ml"
        ? 500 * MICROS_PER_UNIT
        : 10 * MICROS_PER_UNIT;
  const sampleStockMicros = Math.max(recipeMicros * 10, defaultSample);
  const minMicros = Math.max(recipeMicros * 2, Math.round(sampleStockMicros * 0.2));
  const now = Date.now();

  const itemId = await ctx.db.insert("inventoryItems", {
    organizationId: staff.organizationId,
    name: cleanName,
    unit: converted.unit,
    isActive: true,
    category: "Auto-creado desde receta",
    minMicros,
    factorMicros: MICROS_PER_UNIT,
  });
  await ctx.db.insert("inventoryBalances", {
    organizationId: staff.organizationId,
    locationId: staff.locationId,
    inventoryItemId: itemId,
    quantityMicros: sampleStockMicros,
    updatedAt: now,
  });
  await ctx.db.insert("inventoryMovements", {
    organizationId: staff.organizationId,
    locationId: staff.locationId,
    inventoryItemId: itemId,
    kind: "receipt",
    quantityDeltaMicros: sampleStockMicros,
    referenceId: `assistant-sample:${proposalId}:${itemId}`,
    reason: "Muestra inicial auto-creada desde receta (Asistente IA)",
    createdByStaffId: staff._id,
  });

  const created = (await ctx.db.get("inventoryItems", itemId))!;
  invByKey.set(key, created);
  autoCreatedNotes.push(`${cleanName} (${formatMicrosDisplay(sampleStockMicros, converted.unit)})`);
  return { item: created, unit: converted.unit, micros: recipeMicros };
}

export async function applyProposalHelper(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  proposal: Doc<"assistantProposals">,
): Promise<string> {
  if (proposal.status !== "pending") {
    throw new ConvexError("Esta propuesta ya fue procesada.");
  }
  if (proposal.organizationId !== staff.organizationId || proposal.locationId !== staff.locationId) {
    throw new ConvexError("No tienes permiso sobre esta propuesta.");
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(proposal.payload);
  } catch {
    throw new ConvexError("Los datos de la propuesta están dañados.");
  }

  let resultSummary = "";

  if (proposal.kind === "menu_batch") {
    if (!canEditSharedMenu(staff)) {
      throw new ConvexError("Tu cuenta de gerente no tiene permiso para crear platillos en el menú compartido.");
    }
    const data = menuBatchProposalSchema.parse(parsedRaw);

    const [existingCats, existingDishes, existingModGroups, existingInvItems] = await Promise.all([
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("modifierGroups")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
    ]);

    const catByKey = new Map(existingCats.map((c) => [normalizeNameKey(c.name), c._id] as const));
    let nextCatOrder = existingCats.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
    let catsCreated = 0;

    const ensureCategory = async (name: string) => {
      const key = normalizeNameKey(name);
      const found = catByKey.get(key);
      if (found) return found;
      const id = await ctx.db.insert("dishCategories", {
        organizationId: staff.organizationId,
        name: name.trim().slice(0, 80),
        sortOrder: nextCatOrder++,
        isActive: true,
      });
      catByKey.set(key, id);
      catsCreated++;
      return id;
    };

    for (const cat of data.categories) {
      await ensureCategory(cat.name);
    }

    const modGroupByKey = new Map(existingModGroups.map((g) => [normalizeNameKey(g.name), g._id] as const));
    let nextModOrder = existingModGroups.reduce((max, g) => Math.max(max, g.sortOrder), 0) + 1;
    let modGroupsCreated = 0;

    for (const group of data.modifierGroups) {
      const key = normalizeNameKey(group.name);
      if (modGroupByKey.has(key)) continue;
      const groupId = await ctx.db.insert("modifierGroups", {
        organizationId: staff.organizationId,
        name: group.name.trim().slice(0, 80),
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: nextModOrder++,
        isActive: true,
      });
      for (let i = 0; i < group.options.length; i++) {
        const opt = group.options[i];
        await ctx.db.insert("modifierOptions", {
          organizationId: staff.organizationId,
          modifierGroupId: groupId,
          name: opt.name.trim().slice(0, 80),
          priceExtraCents: priceToCents(opt.priceExtra),
          sortOrder: i + 1,
          isActive: true,
        });
      }
      modGroupByKey.set(key, groupId);
      modGroupsCreated++;
    }

    const dishByKey = new Map(existingDishes.map((d) => [normalizeNameKey(d.name), d._id] as const));
    const invByKey = new Map(existingInvItems.map((i) => [normalizeNameKey(i.name), i] as const));
    const autoCreatedSamples: string[] = [];
    let dishesCreated = 0;
    let dishesSkipped = 0;
    let ingredientsLinked = 0;

    for (const dish of data.dishes) {
      const key = normalizeNameKey(dish.name);
      let dishId = dishByKey.get(key);
      if (!dishId) {
        const categoryId = dish.categoryName ? await ensureCategory(dish.categoryName) : undefined;
        let photoId: Id<"_storage"> | undefined;
        if (dish.photoStorageId) {
          const candidateId = dish.photoStorageId as Id<"_storage">;
          const meta = await ctx.db.system.get("_storage", candidateId);
          if (meta) photoId = candidateId;
        }
        dishId = await ctx.db.insert("dishes", {
          organizationId: staff.organizationId,
          name: dish.name.trim().slice(0, 100),
          description: dish.description?.trim() || undefined,
          priceCents: priceToCents(dish.price),
          isAvailable: true,
          isPublished: dish.isPublished,
          buffetExtra: dish.buffetExtra,
          areas: dish.areas,
          categoryId,
          photoId,
        });
        dishByKey.set(key, dishId);
        dishesCreated++;

        if (dish.modifierGroupNames?.length) {
          let sort = 1;
          for (const groupName of dish.modifierGroupNames) {
            const groupId = modGroupByKey.get(normalizeNameKey(groupName));
            if (groupId) {
              await ctx.db.insert("dishModifierGroups", {
                organizationId: staff.organizationId,
                dishId,
                modifierGroupId: groupId,
                sortOrder: sort++,
              });
            }
          }
        }
      } else {
        dishesSkipped++;
      }

      if (dish.ingredients?.length) {
        const existingRecipes = await ctx.db
          .query("recipeIngredients")
          .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dishId))
          .take(100);
        const existingRecipeInvIds = new Set(existingRecipes.map((r) => r.inventoryItemId));

        for (const ing of dish.ingredients) {
          if (ing.inventoryQuantity && ing.inventoryUnit) {
            const converted = convertQuantityToMicros(ing.inventoryQuantity, ing.inventoryUnit);
            if (converted.micros > 0) {
              const ensured = await ensureInventoryItemWithSample(
                ctx,
                staff,
                invByKey,
                ing.name,
                ing.inventoryUnit,
                converted.micros,
                proposal._id,
                autoCreatedSamples,
              );
              if (ensured.item.unit === converted.unit && !existingRecipeInvIds.has(ensured.item._id)) {
                await ctx.db.insert("recipeIngredients", {
                  organizationId: staff.organizationId,
                  dishId,
                  inventoryItemId: ensured.item._id,
                  quantityMicros: converted.micros,
                });
                existingRecipeInvIds.add(ensured.item._id);
                ingredientsLinked++;
              }
            }
          }
          await ctx.db.insert("dishIngredients", {
            organizationId: staff.organizationId,
            dishId,
            name: ing.name.trim().slice(0, 80),
            quantityText:
              ing.quantityText?.trim() ||
              (ing.inventoryQuantity && ing.inventoryUnit
                ? `${ing.inventoryQuantity} ${ing.inventoryUnit}`
                : undefined),
          });
        }
      }
    }

    const sampleNotice =
      autoCreatedSamples.length > 0
        ? ` ⚠️ Insumos faltantes creados con muestra inicial en inventario (ajusta stock y costo real): ${autoCreatedSamples.join(", ")}.`
        : "";
    resultSummary = `Menú aplicado: ${catsCreated} categorías, ${dishesCreated} platillos creados (${dishesSkipped} ya existían), ${modGroupsCreated} grupos de modificadores${ingredientsLinked > 0 ? `, ${ingredientsLinked} ingredientes de receta vinculados` : ""}.${sampleNotice}`;
  } else if (proposal.kind === "inventory_batch") {
    const data = inventoryBatchProposalSchema.parse(parsedRaw);

    const [existingSuppliers, existingItems, existingBalances] = await Promise.all([
      ctx.db
        .query("suppliers")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(400),
    ]);

    const supplierByKey = new Map(existingSuppliers.map((s) => [normalizeNameKey(s.name), s._id] as const));
    let suppliersCreated = 0;

    const ensureSupplier = async (name: string, contact?: string) => {
      const key = normalizeNameKey(name);
      const found = supplierByKey.get(key);
      if (found) return found;
      const id = await ctx.db.insert("suppliers", {
        organizationId: staff.organizationId,
        name: name.trim().slice(0, 100),
        contact: contact?.trim() || undefined,
        isActive: true,
      });
      supplierByKey.set(key, id);
      suppliersCreated++;
      return id;
    };

    for (const sup of data.suppliers) {
      await ensureSupplier(sup.name, sup.contact);
    }

    const itemByKey = new Map(existingItems.map((i) => [normalizeNameKey(i.name), i] as const));
    const balanceByItemId = new Map(existingBalances.map((b) => [b.inventoryItemId, b] as const));

    let itemsCreated = 0;
    let receiptsRecorded = 0;
    let itemsSkipped = 0;
    const now = Date.now();

    for (const row of data.items) {
      const key = normalizeNameKey(row.name);
      const unitInfo = convertQuantityToMicros(1, row.unit);
      const minMicros =
        row.minStock !== undefined ? convertQuantityToMicros(row.minStock, row.unit).micros : undefined;
      const maxMicros =
        row.maxStock !== undefined ? convertQuantityToMicros(row.maxStock, row.unit).micros : undefined;
      const initialMicros =
        row.initialStock !== undefined ? convertQuantityToMicros(row.initialStock, row.unit).micros : 0;

      const supplierId = row.supplierName ? await ensureSupplier(row.supplierName) : undefined;

      let existingItem = itemByKey.get(key);
      let itemId: Id<"inventoryItems">;

      if (!existingItem) {
        itemId = await ctx.db.insert("inventoryItems", {
          organizationId: staff.organizationId,
          name: row.name.trim().slice(0, 100),
          unit: unitInfo.unit,
          isActive: true,
          category: row.category?.trim() || undefined,
          minMicros,
          maxMicros,
          presentation: row.presentation?.trim() || undefined,
          factorMicros: MICROS_PER_UNIT,
          supplierId,
          lastCostCents: row.unitCost !== undefined ? priceToCents(row.unitCost) : undefined,
        });
        existingItem = (await ctx.db.get("inventoryItems", itemId))!;
        itemByKey.set(key, existingItem);
        itemsCreated++;
      } else {
        itemId = existingItem._id;
        itemsSkipped++;
      }

      if (initialMicros > 0 && existingItem.unit === unitInfo.unit) {
        const balance = balanceByItemId.get(itemId);
        if (balance) {
          await ctx.db.patch("inventoryBalances", balance._id, {
            quantityMicros: balance.quantityMicros + initialMicros,
            updatedAt: now,
          });
        } else {
          const balId = await ctx.db.insert("inventoryBalances", {
            organizationId: staff.organizationId,
            locationId: staff.locationId,
            inventoryItemId: itemId,
            quantityMicros: initialMicros,
            updatedAt: now,
          });
          balanceByItemId.set(itemId, (await ctx.db.get("inventoryBalances", balId))!);
        }
        await ctx.db.insert("inventoryMovements", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          inventoryItemId: itemId,
          kind: "receipt",
          quantityDeltaMicros: initialMicros,
          referenceId: `assistant:${proposal._id}:${itemId}`,
          reason: "Importación vía asistente IA",
          createdByStaffId: staff._id,
        });
        receiptsRecorded++;
      }
    }

    resultSummary = `Inventario aplicado: ${suppliersCreated} proveedores, ${itemsCreated} insumos creados (${itemsSkipped} existentes), ${receiptsRecorded} entradas de stock registradas.`;
  } else if (proposal.kind === "buffet_batch") {
    const data = buffetBatchProposalSchema.parse(parsedRaw);
    const allowCreateDishes = canEditSharedMenu(staff);

    const [existingDishes, existingCats] = await Promise.all([
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
    ]);

    const dishByKey = new Map(existingDishes.map((d) => [normalizeNameKey(d.name), d._id] as const));
    const catByKey = new Map(existingCats.map((c) => [normalizeNameKey(c.name), c._id] as const));
    let nextCatOrder = existingCats.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;

    let menusCreated = 0;
    let dishesCreated = 0;
    let dishesLinked = 0;
    let dishesSkippedNoPerm = 0;

    for (const menuSpec of data.menus) {
      const menuId = await ctx.db.insert("buffetMenus", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        name: menuSpec.name.trim().slice(0, 100),
        menuDate: menuSpec.menuDate,
        isActive: true,
      });
      menusCreated++;

      let sort = 1;
      for (const dishSpec of menuSpec.dishes) {
        const key = normalizeNameKey(dishSpec.dishName);
        let dishId = dishByKey.get(key);
        if (!dishId) {
          if (!allowCreateDishes) {
            dishesSkippedNoPerm++;
            continue;
          }
          let categoryId: Id<"dishCategories"> | undefined;
          if (dishSpec.categoryName) {
            const catKey = normalizeNameKey(dishSpec.categoryName);
            categoryId = catByKey.get(catKey);
            if (!categoryId) {
              categoryId = await ctx.db.insert("dishCategories", {
                organizationId: staff.organizationId,
                name: dishSpec.categoryName.trim().slice(0, 80),
                sortOrder: nextCatOrder++,
                isActive: true,
              });
              catByKey.set(catKey, categoryId);
            }
          }
          dishId = await ctx.db.insert("dishes", {
            organizationId: staff.organizationId,
            name: dishSpec.dishName.trim().slice(0, 100),
            description: dishSpec.description?.trim() || undefined,
            priceCents: 0,
            isAvailable: true,
            isPublished: false,
            areas: dishSpec.areas ?? ["kitchen"],
            categoryId,
          });
          dishByKey.set(key, dishId);
          dishesCreated++;
        }

        await ctx.db.insert("buffetMenuDishes", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          buffetMenuId: menuId,
          dishId,
          sortOrder: sort++,
          destination: dishSpec.destination,
          portionsPerTray: dishSpec.portionsPerTray,
        });
        dishesLinked++;
      }
    }

    resultSummary = `Buffet aplicado: ${menusCreated} menús creados, ${dishesLinked} platillos asignados${dishesCreated > 0 ? `, ${dishesCreated} platillos nuevos creados` : ""}${dishesSkippedNoPerm > 0 ? ` (${dishesSkippedNoPerm} omitidos por falta de permiso edit_menu)` : ""}.`;
  } else if (proposal.kind === "floor_batch") {
    const data = floorBatchProposalSchema.parse(parsedRaw);

    const [existingSections, existingTypes] = await Promise.all([
      ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("tableTypes")
        .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId))
        .take(50),
    ]);

    const sectionList = [...existingSections];
    const sectionByKey = new Map(sectionList.map((s) => [normalizeNameKey(s.name), s] as const));
    let nextSecOrder = sectionList.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
    let sectionsCreated = 0;

    const ensureSection = async (name: string, description?: string) => {
      const key = normalizeNameKey(name);
      const found = sectionByKey.get(key);
      if (found) return found;
      const id = await ctx.db.insert("sections", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        name: name.trim().slice(0, 80),
        description: description?.trim() || undefined,
        sortOrder: nextSecOrder++,
        canvas: nextSectionCanvas(sectionList),
      });
      const created = (await ctx.db.get("sections", id))!;
      sectionList.push(created);
      sectionByKey.set(key, created);
      sectionsCreated++;
      return created;
    };

    for (const sec of data.sections) {
      await ensureSection(sec.name, sec.description);
    }

    const typeByKey = new Map(existingTypes.map((t) => [normalizeNameKey(t.name), t] as const));
    let typesCreated = 0;
    for (const t of data.tableTypes) {
      const key = normalizeNameKey(t.name);
      if (typeByKey.has(key)) continue;
      const id = await ctx.db.insert("tableTypes", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        name: t.name.trim().slice(0, 80),
        shape: t.shape,
        seatCount: t.seatCount,
        isActive: true,
      });
      typeByKey.set(key, (await ctx.db.get("tableTypes", id))!);
      typesCreated++;
    }

    // Group tables by section for non-overlapping placement
    const tablesBySectionName = new Map<string, typeof data.tables>();
    for (const t of data.tables) {
      const key = normalizeNameKey(t.sectionName);
      const list = tablesBySectionName.get(key) ?? [];
      list.push(t);
      tablesBySectionName.set(key, list);
    }

    let tablesCreated = 0;
    let tablesSkipped = 0;

    for (const [, group] of tablesBySectionName) {
      const section = await ensureSection(group[0].sectionName);
      const existingTables = await ctx.db
        .query("diningTables")
        .withIndex("by_sectionId_and_tableNumber", (q) => q.eq("sectionId", section._id))
        .take(100);
      const existingNums = new Set(existingTables.map((t) => normalizeNameKey(t.tableNumber)));
      const toCreate = group.filter((t) => !existingNums.has(normalizeNameKey(t.tableNumber)));
      tablesSkipped += group.length - toCreate.length;
      const positions = findNextFreeTablePositions(existingTables, toCreate.length);

      for (let i = 0; i < toCreate.length; i++) {
        const item = toCreate[i];
        const pos = positions[i];
        const matchedType = item.tableTypeName ? typeByKey.get(normalizeNameKey(item.tableTypeName)) : undefined;
        await ctx.db.insert("diningTables", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          sectionId: section._id,
          tableTypeId: matchedType?._id,
          tableNumber: item.tableNumber.trim().slice(0, 40),
          seatCount: matchedType?.seatCount ?? item.seatCount,
          shape: matchedType?.shape ?? item.shape,
          canvas: {
            x: pos.x,
            y: pos.y,
            width: section.canvas.width,
            height: section.canvas.height,
            rotation: 0,
          },
          status: "empty",
          isActive: true,
          qrToken: crypto.randomUUID(),
          qrEnabled: true,
          qrCreatedAt: Date.now(),
          qrVersion: 1,
        });
        tablesCreated++;
      }
    }

    resultSummary = `Plano aplicado: ${sectionsCreated} secciones, ${typesCreated} tipos de mesa y ${tablesCreated} mesas creadas (${tablesSkipped} duplicadas omitidas).`;
  } else if (proposal.kind === "floor_layout_changes") {
    const data = floorLayoutChangesProposalSchema.parse(parsedRaw);

    const [sections, tables, tableTypes] = await Promise.all([
      ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("diningTables")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true))
        .take(150),
      ctx.db
        .query("tableTypes")
        .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId))
        .take(50),
    ]);

    const sectionByKey = new Map(sections.map((s) => [normalizeNameKey(s.name), s] as const));
    const typeByKey = new Map(tableTypes.map((t) => [normalizeNameKey(t.name), t] as const));
    let sectionsUpdated = 0;
    let tablesUpdated = 0;
    const notFound: string[] = [];

    for (const move of data.sectionMoves) {
      const sec = sectionByKey.get(normalizeNameKey(move.sectionName));
      if (!sec) {
        notFound.push(`sección "${move.sectionName}"`);
        continue;
      }
      const x = Math.max(0, Math.min(90, Math.round((move.x ?? sec.canvas.x) * 10) / 10));
      const width = Math.max(10, Math.min(100 - x, Math.round((move.width ?? sec.canvas.width) * 10) / 10));
      const y = Math.max(0, Math.min(990, Math.round((move.y ?? sec.canvas.y) * 10) / 10));
      const height = Math.max(8, Math.min(1000 - y, Math.round((move.height ?? sec.canvas.height) * 10) / 10));
      const nextCanvas = { x, y, width, height, rotation: sec.canvas.rotation ?? 0 };
      const nextName = move.newName?.trim().slice(0, 80) || sec.name;
      const patch: Partial<Doc<"sections">> = {
        name: nextName,
        canvas: nextCanvas,
      };
      if (move.description !== undefined) {
        patch.description = move.description.trim() || undefined;
      }
      await ctx.db.patch("sections", sec._id, patch);
      const updatedSec = { ...sec, ...patch };
      sectionByKey.set(normalizeNameKey(sec.name), updatedSec);
      sectionByKey.set(normalizeNameKey(nextName), updatedSec);
      sectionsUpdated++;
    }

    for (const move of data.tableMoves) {
      const targetNumKey = normalizeNameKey(move.tableNumber);
      const fromSecKey = move.fromSectionName ? normalizeNameKey(move.fromSectionName) : null;
      const matchedTable = tables.find((t) => {
        if (normalizeNameKey(t.tableNumber) !== targetNumKey) return false;
        if (!fromSecKey) return true;
        const sec = sections.find((s) => s._id === t.sectionId);
        return sec ? normalizeNameKey(sec.name) === fromSecKey : false;
      });
      if (!matchedTable) {
        notFound.push(`mesa "${move.tableNumber}"`);
        continue;
      }

      const destSection = move.toSectionName
        ? sectionByKey.get(normalizeNameKey(move.toSectionName))
        : sectionByKey.get(
            normalizeNameKey(sections.find((s) => s._id === matchedTable.sectionId)?.name ?? ""),
          ) ?? sections.find((s) => s._id === matchedTable.sectionId);

      if (!destSection) {
        notFound.push(`sección destino "${move.toSectionName}"`);
        continue;
      }

      const x = Math.max(8, Math.min(92, Math.round((move.x ?? matchedTable.canvas.x) * 10) / 10));
      const y = Math.max(12, Math.min(88, Math.round((move.y ?? matchedTable.canvas.y) * 10) / 10));
      const matchedType = move.tableTypeName ? typeByKey.get(normalizeNameKey(move.tableTypeName)) : undefined;

      const patch: Partial<Doc<"diningTables">> = {
        sectionId: destSection._id,
        canvas: {
          x,
          y,
          width: destSection.canvas.width,
          height: destSection.canvas.height,
          rotation: matchedTable.canvas.rotation ?? 0,
        },
      };
      if (move.newTableNumber) patch.tableNumber = move.newTableNumber.trim().slice(0, 40);
      if (matchedType) {
        patch.tableTypeId = matchedType._id;
        patch.seatCount = move.seatCount ?? matchedType.seatCount;
        patch.shape = move.shape ?? matchedType.shape;
      } else {
        if (move.seatCount !== undefined) patch.seatCount = move.seatCount;
        if (move.shape !== undefined) patch.shape = move.shape;
      }

      await ctx.db.patch("diningTables", matchedTable._id, patch);
      tablesUpdated++;
    }

    const missedNote = notFound.length > 0 ? ` (no encontrados: ${notFound.join(", ")})` : "";
    resultSummary = `Plano actualizado: ${sectionsUpdated} secciones y ${tablesUpdated} mesas editadas.${missedNote}`;
  } else if (proposal.kind === "menu_edits") {
    if (!canEditSharedMenu(staff)) {
      throw new ConvexError("Tu cuenta de gerente no tiene permiso para editar el menú compartido.");
    }
    const data = menuEditsProposalSchema.parse(parsedRaw);

    const [existingCats, existingDishes, existingModGroups] = await Promise.all([
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("modifierGroups")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
    ]);

    const catByKey = new Map(existingCats.map((c) => [normalizeNameKey(c.name), c._id] as const));
    let nextCatOrder = existingCats.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
    const dishByKey = new Map(existingDishes.map((d) => [normalizeNameKey(d.name), d] as const));
    const modByKey = new Map(existingModGroups.map((g) => [normalizeNameKey(g.name), g._id] as const));

    let dishesUpdated = 0;
    let photosAttached = 0;
    const missingDishes: string[] = [];

    for (const edit of data.dishes) {
      const dish = dishByKey.get(normalizeNameKey(edit.dishName));
      if (!dish) {
        missingDishes.push(edit.dishName);
        continue;
      }

      const patch: Partial<Doc<"dishes">> = {};
      if (edit.newName) patch.name = edit.newName.trim().slice(0, 100);
      if (edit.description !== undefined) patch.description = edit.description.trim() || undefined;
      if (edit.price !== undefined) patch.priceCents = priceToCents(edit.price);
      if (edit.areas) patch.areas = edit.areas;
      if (edit.isAvailable !== undefined) patch.isAvailable = edit.isAvailable;
      if (edit.isPublished !== undefined) patch.isPublished = edit.isPublished;
      if (edit.buffetExtra !== undefined) patch.buffetExtra = edit.buffetExtra;

      if (edit.categoryName) {
        const cKey = normalizeNameKey(edit.categoryName);
        let categoryId = catByKey.get(cKey);
        if (!categoryId) {
          categoryId = await ctx.db.insert("dishCategories", {
            organizationId: staff.organizationId,
            name: edit.categoryName.trim().slice(0, 80),
            sortOrder: nextCatOrder++,
            isActive: true,
          });
          catByKey.set(cKey, categoryId);
        }
        patch.categoryId = categoryId;
      }

      if (edit.photoStorageId) {
        const candidateId = edit.photoStorageId as Id<"_storage">;
        const meta = await ctx.db.system.get("_storage", candidateId);
        if (meta) {
          patch.photoId = candidateId;
          photosAttached++;
        }
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch("dishes", dish._id, patch);
      }

      if (edit.addModifierGroupNames?.length) {
        const existingLinks = await ctx.db
          .query("dishModifierGroups")
          .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dish._id))
          .take(50);
        const linkedIds = new Set(existingLinks.map((l) => l.modifierGroupId));
        let sort = existingLinks.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 1;
        for (const gName of edit.addModifierGroupNames) {
          const gId = modByKey.get(normalizeNameKey(gName));
          if (gId && !linkedIds.has(gId)) {
            await ctx.db.insert("dishModifierGroups", {
              organizationId: staff.organizationId,
              dishId: dish._id,
              modifierGroupId: gId,
              sortOrder: sort++,
            });
            linkedIds.add(gId);
          }
        }
      }

      dishesUpdated++;
    }

    const photoNote = photosAttached > 0 ? ` (${photosAttached} fotos asignadas)` : "";
    const missingNote = missingDishes.length > 0 ? ` No encontrados: ${missingDishes.join(", ")}.` : "";
    resultSummary = `Ediciones de menú aplicadas: ${dishesUpdated} platillos actualizados${photoNote}.${missingNote}`;
  } else if (proposal.kind === "inventory_edits") {
    const data = inventoryEditsProposalSchema.parse(parsedRaw);

    const [existingItems, existingSuppliers] = await Promise.all([
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("suppliers")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
    ]);

    const itemByKey = new Map(existingItems.map((i) => [normalizeNameKey(i.name), i] as const));
    const supByKey = new Map(existingSuppliers.map((s) => [normalizeNameKey(s.name), s._id] as const));

    let itemsUpdated = 0;
    const missingItems: string[] = [];

    for (const edit of data.items) {
      const item = itemByKey.get(normalizeNameKey(edit.itemName));
      if (!item) {
        missingItems.push(edit.itemName);
        continue;
      }

      const patch: Partial<Doc<"inventoryItems">> = {};
      if (edit.newName) patch.name = edit.newName.trim().slice(0, 100);
      if (edit.category !== undefined) patch.category = edit.category.trim() || undefined;
      if (edit.presentation !== undefined) patch.presentation = edit.presentation.trim() || undefined;
      if (edit.unitCost !== undefined) patch.lastCostCents = priceToCents(edit.unitCost);

      const effectiveUnit = edit.unit ?? item.unit;
      if (edit.minStock !== undefined) {
        const conv = convertQuantityToMicros(edit.minStock, effectiveUnit);
        if (conv.unit === item.unit) patch.minMicros = conv.micros;
      }
      if (edit.maxStock !== undefined) {
        const conv = convertQuantityToMicros(edit.maxStock, effectiveUnit);
        if (conv.unit === item.unit) patch.maxMicros = conv.micros;
      }

      if (edit.supplierName) {
        const sKey = normalizeNameKey(edit.supplierName);
        let supId = supByKey.get(sKey);
        if (!supId) {
          supId = await ctx.db.insert("suppliers", {
            organizationId: staff.organizationId,
            name: edit.supplierName.trim().slice(0, 100),
            isActive: true,
          });
          supByKey.set(sKey, supId);
        }
        patch.supplierId = supId;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch("inventoryItems", item._id, patch);
      }
      itemsUpdated++;
    }

    const missingNote = missingItems.length > 0 ? ` No encontrados: ${missingItems.join(", ")}.` : "";
    resultSummary = `Ediciones de inventario aplicadas: ${itemsUpdated} insumos actualizados.${missingNote}`;
  } else if (proposal.kind === "inventory_receipt") {
    const data = inventoryReceiptProposalSchema.parse(parsedRaw);

    const [existingSuppliers, existingItems, existingBalances] = await Promise.all([
      ctx.db
        .query("suppliers")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(150),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(400),
    ]);

    const supByKey = new Map(existingSuppliers.map((s) => [normalizeNameKey(s.name), s._id] as const));
    let supplierId: Id<"suppliers"> | undefined;
    if (data.supplierName) {
      const sKey = normalizeNameKey(data.supplierName);
      supplierId = supByKey.get(sKey);
      if (!supplierId) {
        supplierId = await ctx.db.insert("suppliers", {
          organizationId: staff.organizationId,
          name: data.supplierName.trim().slice(0, 100),
          isActive: true,
        });
        supByKey.set(sKey, supplierId);
      }
    }

    const itemByKey = new Map(existingItems.map((i) => [normalizeNameKey(i.name), i] as const));
    const balanceByItemId = new Map(existingBalances.map((b) => [b.inventoryItemId, b] as const));
    const now = Date.now();
    const reason = data.invoiceRef
      ? `Factura/nota ${data.invoiceRef}${data.supplierName ? ` · ${data.supplierName}` : ""}`
      : `Entrada por factura/ticket${data.supplierName ? ` · ${data.supplierName}` : ""} (Asistente IA)`;

    let itemsCreated = 0;
    let receiptsCount = 0;
    let costsUpdated = 0;

    for (const line of data.items) {
      const conv = convertQuantityToMicros(line.quantity, line.unit);
      if (conv.micros <= 0) continue;

      const key = normalizeNameKey(line.itemName);
      let item = itemByKey.get(key);
      if (!item) {
        const defaultFactor = conv.unit === "each" ? MICROS_PER_UNIT : 1000 * MICROS_PER_UNIT;
        const itemId = await ctx.db.insert("inventoryItems", {
          organizationId: staff.organizationId,
          name: line.itemName.trim().slice(0, 100),
          unit: conv.unit,
          isActive: true,
          category: line.category?.trim() || "Factura",
          factorMicros: defaultFactor,
          supplierId,
          lastCostCents: line.unitCost !== undefined ? priceToCents(line.unitCost) : undefined,
        });
        item = (await ctx.db.get("inventoryItems", itemId))!;
        itemByKey.set(key, item);
        itemsCreated++;
        if (line.unitCost !== undefined) costsUpdated++;
      } else {
        const patch: Partial<Doc<"inventoryItems">> = {};
        if (line.unitCost !== undefined) {
          patch.lastCostCents = priceToCents(line.unitCost);
          costsUpdated++;
        }
        if (supplierId && !item.supplierId) {
          patch.supplierId = supplierId;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch("inventoryItems", item._id, patch);
        }
      }

      if (item.unit !== conv.unit) continue;

      const balance = balanceByItemId.get(item._id);
      if (balance) {
        const nextQty = balance.quantityMicros + conv.micros;
        await ctx.db.patch("inventoryBalances", balance._id, {
          quantityMicros: nextQty,
          updatedAt: now,
        });
        balanceByItemId.set(item._id, { ...balance, quantityMicros: nextQty, updatedAt: now });
      } else {
        const balId = await ctx.db.insert("inventoryBalances", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          inventoryItemId: item._id,
          quantityMicros: conv.micros,
          updatedAt: now,
        });
        balanceByItemId.set(item._id, (await ctx.db.get("inventoryBalances", balId))!);
      }

      await ctx.db.insert("inventoryMovements", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        inventoryItemId: item._id,
        kind: "receipt",
        quantityDeltaMicros: conv.micros,
        referenceId: `assistant-receipt:${proposal._id}:${item._id}`,
        reason,
        createdByStaffId: staff._id,
      });
      receiptsCount++;
    }

    resultSummary = `Entrada aplicada: ${receiptsCount} recepciones registradas${costsUpdated > 0 ? `, ${costsUpdated} costos actualizados` : ""}${itemsCreated > 0 ? `, ${itemsCreated} insumos nuevos creados` : ""}.`;
  } else if (proposal.kind === "section_assignments") {
    const data = sectionAssignmentsProposalSchema.parse(parsedRaw);

    const [sections, activeStaff] = await Promise.all([
      ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true))
        .take(80),
    ]);

    const sectionByKey = new Map(sections.map((s) => [normalizeNameKey(s.name), s] as const));
    const waiterByKey = new Map(
      activeStaff
        .filter((m) => m.roles.includes("waiter"))
        .map((m) => [normalizeNameKey(m.displayName), m] as const),
    );

    const now = Date.now();
    let assignedCount = 0;
    const issues: string[] = [];

    for (const pair of data.assignments) {
      const section = sectionByKey.get(normalizeNameKey(pair.sectionName));
      if (!section) {
        issues.push(`sección "${pair.sectionName}" no encontrada`);
        continue;
      }
      const waiter = waiterByKey.get(normalizeNameKey(pair.waiterName));
      if (!waiter) {
        issues.push(`mesero activo "${pair.waiterName}" no encontrado`);
        continue;
      }

      const current = await ctx.db
        .query("sectionAssignments")
        .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", section._id))
        .order("desc")
        .first();
      if (current && current.endsAt === undefined) {
        await ctx.db.patch("sectionAssignments", current._id, { endsAt: now });
      }

      await ctx.db.insert("sectionAssignments", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        sectionId: section._id,
        assignedStaffId: waiter._id,
        assignedByStaffId: staff._id,
        startsAt: now,
      });
      assignedCount++;
    }

    const issueNote = issues.length > 0 ? ` (${issues.join("; ")})` : "";
    resultSummary = `Asignaciones aplicadas: ${assignedCount} secciones asignadas a meseros.${issueNote}`;
  } else if (proposal.kind === "recipe_batch") {
    if (!canEditSharedMenu(staff)) {
      throw new ConvexError("Tu cuenta de gerente no tiene permiso para editar recetas del menú compartido.");
    }
    const data = recipeBatchProposalSchema.parse(parsedRaw);

    const [existingDishes, existingInvItems] = await Promise.all([
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(400),
    ]);

    const dishByKey = new Map(existingDishes.map((d) => [normalizeNameKey(d.name), d] as const));
    const invByKey = new Map(existingInvItems.map((i) => [normalizeNameKey(i.name), i] as const));
    const autoCreatedSamples: string[] = [];
    const missingDishes: string[] = [];
    let dishesUpdated = 0;
    let ingredientsLinked = 0;

    for (const entry of data.recipes) {
      const dish = dishByKey.get(normalizeNameKey(entry.dishName));
      if (!dish) {
        missingDishes.push(entry.dishName);
        continue;
      }

      const existingRecipes = await ctx.db
        .query("recipeIngredients")
        .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
        .take(100);
      const recipeByInvId = new Map(existingRecipes.map((r) => [r.inventoryItemId, r] as const));

      for (const ing of entry.ingredients) {
        const converted = convertQuantityToMicros(ing.quantity, ing.unit);
        if (converted.micros <= 0) continue;

        const ensured = await ensureInventoryItemWithSample(
          ctx,
          staff,
          invByKey,
          ing.name,
          ing.unit,
          converted.micros,
          proposal._id,
          autoCreatedSamples,
        );

        if (ensured.item.unit !== converted.unit) continue;

        const existingLink = recipeByInvId.get(ensured.item._id);
        if (existingLink) {
          await ctx.db.patch("recipeIngredients", existingLink._id, {
            quantityMicros: converted.micros,
          });
        } else {
          const recId = await ctx.db.insert("recipeIngredients", {
            organizationId: staff.organizationId,
            dishId: dish._id,
            inventoryItemId: ensured.item._id,
            quantityMicros: converted.micros,
          });
          recipeByInvId.set(ensured.item._id, (await ctx.db.get("recipeIngredients", recId))!);
        }
        ingredientsLinked++;
      }

      dishesUpdated++;
    }

    const sampleNotice =
      autoCreatedSamples.length > 0
        ? ` ⚠️ Insumos que no estaban en inventario creados con muestra inicial (ajusta stock y costo real): ${autoCreatedSamples.join(", ")}.`
        : "";
    const missingNotice =
      missingDishes.length > 0 ? ` Platillos no encontrados: ${missingDishes.join(", ")}.` : "";
    resultSummary = `Recetas aplicadas: ${dishesUpdated} platillos actualizados con ${ingredientsLinked} ingredientes vinculados.${sampleNotice}${missingNotice}`;
  }

  await ctx.db.patch("assistantProposals", proposal._id, {
    status: "approved",
    resultSummary,
    decidedByStaffId: staff._id,
    decidedAt: Date.now(),
  });

  return resultSummary;
}
