import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { loadMenuBackground } from "./menu";
import { loadLocationDishAvailability, resolveDishAvailability } from "./model/dishes";
import { usesAssignedTables } from "../lib/restaurant-roles";
import { formatFolio, loadAccountPaymentTotals } from "./model/billing";
import { emitNotification } from "./model/notifications";
import { computeItemProgress, dishOrderRestriction } from "./model/orders";
import { accountState, buffetAdmission, menuBackgroundView, orderStatus, serviceMode } from "./model/validators";

const CALL_COOLDOWN_MS = 20_000;

const dinerCategoryValidator = v.object({
  _id: v.id("dishCategories"),
  name: v.string(),
});

const dinerDishValidator = v.object({
  _id: v.id("dishes"),
  name: v.string(),
  description: v.string(),
  priceCents: v.number(),
  categoryId: v.union(v.id("dishCategories"), v.null()),
  photoUrl: v.union(v.string(), v.null()),
  soldOut: v.boolean(),
  modifierSummaries: v.array(
    v.object({
      groupName: v.string(),
      required: v.boolean(),
      options: v.array(
        v.object({
          name: v.string(),
          priceExtraCents: v.number(),
        }),
      ),
    }),
  ),
});

const dinerAccountItemValidator = v.object({
  _id: v.id("orderItems"),
  dishName: v.string(),
  quantity: v.number(),
  deliveredQuantity: v.number(),
  unitPriceCents: v.number(),
  lineTotalCents: v.number(),
  comments: v.string(),
  status: orderStatus,
  modifiersText: v.string(),
});

const dinerAccountValidator = v.object({
  folio: v.number(),
  state: accountState,
  openedAt: v.number(),
  billRequestedAt: v.union(v.number(), v.null()),
  totalCents: v.number(),
  buffetAdmission: v.union(buffetAdmission, v.null()),
  discountCents: v.number(),
  discountReason: v.union(v.string(), v.null()),
  paidCents: v.number(),
  balanceCents: v.number(),
  deliveredUnits: v.number(),
  totalUnits: v.number(),
  hasUndelivered: v.boolean(),
  canRequestBill: v.boolean(),
  billLockReason: v.union(v.string(), v.null()),
  items: v.array(dinerAccountItemValidator),
});

async function loadPublicMenu(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  location: Doc<"locations">,
) {
  if (!usesAssignedTables(location)) return { categories: [], dishes: [] };
  const [categories, dishes, groups, balances] = await Promise.all([
    ctx.db
      .query("dishCategories")
      .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", organizationId))
      .take(100),
    ctx.db
      .query("dishes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .take(200),
    ctx.db
      .query("modifierGroups")
      .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", organizationId))
      .take(100),
    ctx.db
      .query("inventoryBalances")
      .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", location._id))
      .take(200),
  ]);

  const activeCategories = categories.filter((c) => c.isActive);
  const activeCategoryIds = new Set(activeCategories.map((c) => c._id));
  const autoSoldOut = location.autoSoldOut ?? true;
  const availabilityMap = await loadLocationDishAvailability(ctx, location._id);
  const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));

  const groupMap = new Map<
    Id<"modifierGroups">,
    { name: string; required: boolean; options: Array<{ name: string; priceExtraCents: number }> }
  >();
  for (const group of groups.filter((g) => g.isActive)) {
    const opts = await ctx.db
      .query("modifierOptions")
      .withIndex("by_modifierGroupId_and_name", (q) => q.eq("modifierGroupId", group._id))
      .take(40);
    const activeOpts = opts
      .filter((o) => o.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((o) => ({ name: o.name, priceExtraCents: o.priceExtraCents }));
    if (activeOpts.length > 0) {
      groupMap.set(group._id, {
        name: group.name,
        required: group.minSelections > 0,
        options: activeOpts,
      });
    }
  }

  const publishedDishes = await Promise.all(
    dishes
      .filter((dish) => !dishOrderRestriction(dish, location) && (!dish.categoryId || activeCategoryIds.has(dish.categoryId)))
      .map(async (dish) => {
        const [photoUrl, modLinks, recipeRows] = await Promise.all([
          dish.photoId ? ctx.storage.getUrl(dish.photoId) : Promise.resolve(null),
          ctx.db
            .query("dishModifierGroups")
            .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dish._id))
            .take(20),
          autoSoldOut
            ? ctx.db
                .query("recipeIngredients")
                .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
                .take(50)
            : Promise.resolve([]),
        ]);
        const soldByInventory =
          autoSoldOut && recipeRows.some((row) => (balanceMap.get(row.inventoryItemId) ?? 0) <= 0);
        const modifierSummaries = modLinks
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((link) => {
            const g = groupMap.get(link.modifierGroupId);
            if (!g) return null;
            return {
              groupName: g.name,
              required: g.required,
              options: g.options,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        return {
          _id: dish._id,
          name: dish.name,
          description: dish.description ?? "",
          priceCents: dish.priceCents,
          categoryId: dish.categoryId ?? null,
          photoUrl,
          soldOut: !resolveDishAvailability(dish, availabilityMap) || soldByInventory,
          modifierSummaries,
        };
      }),
  );

  return {
    categories: activeCategories.map((c) => ({ _id: c._id, name: c.name })),
    dishes: publishedDishes.sort((a, b) => a.name.localeCompare(b.name, "es-MX")),
  };
}

async function loadDinerAccountSummary(ctx: QueryCtx, account: Doc<"accounts">) {
  const [orders, payTotals] = await Promise.all([
    ctx.db
      .query("orders")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(50),
    loadAccountPaymentTotals(ctx, account._id),
  ]);

  const items: Array<{
    _id: Id<"orderItems">;
    dishName: string;
    quantity: number;
    deliveredQuantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    comments: string;
    status: Doc<"orderItems">["status"];
    modifiersText: string;
  }> = [];

  for (const order of orders) {
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);
    for (const item of orderItems) {
      if (item.status === "cancelled") continue;
      const [mods, preps] = await Promise.all([
        ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id))
          .take(30),
        ctx.db
          .query("orderItemPreparations")
          .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
          .take(10),
      ]);
      const extraPerUnit = mods.reduce((sum, m) => sum + m.unitPriceExtraCents * m.quantity, 0);
      const lineTotalCents = (item.unitPriceCents + extraPerUnit) * item.quantity;
      const progress = computeItemProgress(item, preps);
      items.push({
        _id: item._id,
        dishName: item.dishName,
        quantity: item.quantity,
        deliveredQuantity: progress.deliveredQuantity,
        unitPriceCents: item.unitPriceCents + extraPerUnit,
        lineTotalCents,
        comments: item.comments ?? "",
        status: progress.status,
        modifiersText: mods.map((m) => m.optionName).join(", "),
      });
    }
  }

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const deliveredUnits = items.reduce((sum, i) => sum + i.deliveredQuantity, 0);
  const hasUndelivered = items.some((i) => i.deliveredQuantity < i.quantity);
  const pendingUnits = Math.max(0, totalUnits - deliveredUnits);

  // Strictly unlocked ONLY when account is open, has ordered items, and ALL plates are delivered
  // (the exact state prior to "solicitó cuenta").
  let canRequestBill = false;
  let billLockReason: string | null = null;
  if (account.state === "awaiting_payment") {
    billLockReason = "Ya solicitaron la cuenta. Enseguida se acercará tu mesero.";
  } else if (account.state !== "open") {
    billLockReason = "Esta cuenta ya finalizó.";
  } else if (totalUnits === 0 && !account.buffetAdmission) {
    billLockReason = "Aún no hay platillos registrados en tu mesa.";
  } else if (hasUndelivered) {
    billLockReason =
      pendingUnits === 1
        ? "Se desbloquea cuando te entreguen tu último platillo pendiente."
        : `Se desbloquea cuando te entreguen todos tus platillos (faltan ${pendingUnits} por llegar).`;
  } else {
    canRequestBill = true;
  }

  return {
    folio: account.folio,
    state: account.state,
    openedAt: account._creationTime,
    billRequestedAt: account.billRequestedAt ?? null,
    totalCents: account.totalCents,
    buffetAdmission: account.buffetAdmission ?? null,
    discountCents: account.discountCents ?? 0,
    discountReason: account.discountReason ?? null,
    paidCents: payTotals.paidCents,
    balanceCents: Math.max(0, account.totalCents - payTotals.paidCents),
    deliveredUnits,
    totalUnits,
    hasUndelivered,
    canRequestBill,
    billLockReason,
    items,
  };
}

async function resolveTableWaiter(
  ctx: QueryCtx,
  table: Doc<"diningTables">,
  account: Doc<"accounts"> | null,
): Promise<Id<"staff"> | null> {
  if (account?.assignedStaffId) return account.assignedStaffId;
  if (table.assignedStaffId) return table.assignedStaffId;
  const latest = await ctx.db
    .query("sectionAssignments")
    .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", table.sectionId))
    .order("desc")
    .take(1);
  const active = latest[0];
  return active && active.endsAt === undefined ? active.assignedStaffId : null;
}

async function activeTableAccount(ctx: QueryCtx, table: Doc<"diningTables">) {
  const account = table.currentAccountId ? await ctx.db.get("accounts", table.currentAccountId) : null;
  return account?.locationId === table.locationId && (account.state === "open" || account.state === "awaiting_payment")
    ? account : null;
}

export const tableByQrToken = query({
  args: { qrToken: v.string() },
  returns: v.union(
    v.object({ status: v.literal("invalid") }),
    v.object({ status: v.literal("buffet"), locationId: v.id("locations") }),
    v.object({
      status: v.literal("paused"),
      restaurantName: v.string(),
      locationName: v.string(),
      locationId: v.id("locations"),
    }),
    v.object({
      status: v.literal("ready"),
      restaurantName: v.string(),
      locationName: v.string(),
      locationId: v.id("locations"),
      currencyCode: v.string(),
      serviceMode,
      timeZone: v.string(),
      menuBackground: menuBackgroundView,
      table: v.object({
        tableNumber: v.string(),
        sectionName: v.string(),
        seatCount: v.number(),
      }),
      categories: v.array(dinerCategoryValidator),
      dishes: v.array(dinerDishValidator),
      account: v.union(dinerAccountValidator, v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const token = args.qrToken.trim();
    if (!token) return { status: "invalid" as const };

    const table = await ctx.db
      .query("diningTables")
      .withIndex("by_qrToken", (q) => q.eq("qrToken", token))
      .unique();
    if (!table || !table.isActive) {
      return { status: "invalid" as const };
    }

    const [restaurant, location, section] = await Promise.all([
      ctx.db.get("organizations", table.organizationId),
      ctx.db.get("locations", table.locationId),
      ctx.db.get("sections", table.sectionId),
    ]);
    if (!restaurant || !location) {
      return { status: "invalid" as const };
    }

    if (!table.qrEnabled) {
      return {
        status: "paused" as const,
        restaurantName: restaurant.name,
        locationName: location.name,
        locationId: location._id,
      };
    }

    const activeAccount = await activeTableAccount(ctx, table);
    if (!usesAssignedTables(location) && !activeAccount) return { status: "buffet" as const, locationId: location._id };

    const [menu, accountSummary, menuBackground] = await Promise.all([
      loadPublicMenu(ctx, table.organizationId, location),
      activeAccount ? loadDinerAccountSummary(ctx, activeAccount) : Promise.resolve(null),
      loadMenuBackground(ctx, restaurant),
    ]);

    return {
      status: "ready" as const,
      restaurantName: restaurant.name,
      locationName: location.name,
      locationId: location._id,
      currencyCode: restaurant.currencyCode,
      serviceMode: location.serviceMode,
      timeZone: location.timeZone,
      menuBackground,
      table: {
        tableNumber: table.tableNumber,
        sectionName: section?.name ?? "Salón",
        seatCount: table.seatCount,
      },
      categories: menu.categories,
      dishes: menu.dishes,
      account: accountSummary,
    };
  },
});

export const publicMenu = query({
  args: { locationId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("invalid") }),
    v.object({
      status: v.literal("ready"),
      restaurantName: v.string(),
      locationName: v.string(),
      locationId: v.id("locations"),
      currencyCode: v.string(),
      serviceMode,
      timeZone: v.string(),
      menuBackground: menuBackgroundView,
      categories: v.array(dinerCategoryValidator),
      dishes: v.array(dinerDishValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const normalized = ctx.db.normalizeId("locations", args.locationId.trim());
    if (!normalized) return { status: "invalid" as const };
    const location = await ctx.db.get("locations", normalized);
    if (!location) return { status: "invalid" as const };
    const restaurant = await ctx.db.get("organizations", location.organizationId);
    if (!restaurant) return { status: "invalid" as const };

    const [menu, menuBackground] = await Promise.all([
      loadPublicMenu(ctx, location.organizationId, location), loadMenuBackground(ctx, restaurant),
    ]);
    return {
      status: "ready" as const,
      restaurantName: restaurant.name,
      locationName: location.name,
      locationId: location._id,
      currencyCode: restaurant.currencyCode,
      serviceMode: location.serviceMode,
      timeZone: location.timeZone,
      menuBackground,
      categories: menu.categories,
      dishes: menu.dishes,
    };
  },
});

export const callWaiter = mutation({
  args: {
    qrToken: v.string(),
    guestName: v.optional(v.string()),
  },
  returns: v.object({
    notified: v.boolean(),
    cooldown: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const table = await ctx.db
      .query("diningTables")
      .withIndex("by_qrToken", (q) => q.eq("qrToken", args.qrToken.trim()))
      .unique();
    if (!table || !table.isActive || !table.qrEnabled) {
      throw new ConvexError("Este código QR no está activo en este momento.");
    }

    const [location, account] = await Promise.all([
      ctx.db.get("locations", table.locationId), activeTableAccount(ctx, table),
    ]);
    if (!location || (!usesAssignedTables(location) && !account)) {
      throw new ConvexError("Esta sucursal usa asientos libres para el buffet.");
    }

    const now = Date.now();
    const recentNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_locationId_and_createdAt", (q) => q.eq("locationId", table.locationId))
      .order("desc")
      .take(20);
    const callTitle = `${table.tableNumber} te está llamando`;
    const recentlyCalled = recentNotifs.some(
      (n) => n.title === callTitle && now - n.createdAt < CALL_COOLDOWN_MS,
    );
    if (recentlyCalled) {
      return { notified: false, cooldown: true };
    }

    const waiterId = await resolveTableWaiter(ctx, table, account);
    const guest = args.guestName?.trim().slice(0, 40);
    const body = guest
      ? `${guest} solicita atención en ${table.tableNumber}.`
      : `Un comensal solicita atención en ${table.tableNumber}.`;

    await emitNotification(ctx, {
      organizationId: table.organizationId,
      locationId: table.locationId,
      kind: "info",
      title: callTitle,
      body,
      targetStaffId: waiterId ?? undefined,
      targetRoles: waiterId ? undefined : ["waiter", "cashier", "owner", "manager"],
      accountId: account?._id,
      href: account ? `/cuenta/mesero/cuenta/${account._id}` : `/cuenta/mesero/mesa/${table._id}`,
      actionLabel: account ? "Abrir cuenta" : "Ver mesa",
    });

    if (account) {
      await ctx.db.insert("serviceRequests", {
        organizationId: table.organizationId,
        locationId: table.locationId,
        accountId: account._id,
        kind: "call_waiter",
        state: "pending",
        requestId: `qr_call:${table._id}:${now}`,
      });
    }

    return { notified: true, cooldown: false };
  },
});

export const requestBill = mutation({
  args: {
    qrToken: v.string(),
    guestName: v.optional(v.string()),
  },
  returns: v.object({
    folio: v.number(),
    totalCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const table = await ctx.db
      .query("diningTables")
      .withIndex("by_qrToken", (q) => q.eq("qrToken", args.qrToken.trim()))
      .unique();
    if (!table || !table.isActive || !table.qrEnabled) {
      throw new ConvexError("Este código QR no está activo en este momento.");
    }
    if (!table.currentAccountId) {
      throw new ConvexError("Todavía no hay una cuenta abierta en esta mesa.");
    }

    const account = await ctx.db.get("accounts", table.currentAccountId);
    if (!account || account.locationId !== table.locationId) {
      throw new ConvexError("Todavía no hay una cuenta abierta en esta mesa.");
    }
    if (account.state === "awaiting_payment") {
      return { folio: account.folio, totalCents: account.totalCents };
    }
    if (account.state !== "open") {
      throw new ConvexError("Esta cuenta ya finalizó.");
    }

    const summary = await loadDinerAccountSummary(ctx, account);
    if (summary.totalUnits === 0 && !account.buffetAdmission) {
      throw new ConvexError("Aún no hay platillos registrados en esta mesa.");
    }
    if (summary.hasUndelivered) {
      throw new ConvexError(
        summary.billLockReason ??
          "Solo puedes pedir la cuenta cuando ya hayan entregado todos tus platillos.",
      );
    }

    const now = Date.now();
    await ctx.db.patch("accounts", account._id, {
      state: "awaiting_payment",
      billRequestedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("diningTables", table._id, { status: "payment" });

    await ctx.db.insert("serviceRequests", {
      organizationId: table.organizationId,
      locationId: table.locationId,
      accountId: account._id,
      kind: "request_bill",
      state: "pending",
      requestId: `qr_bill:${account._id}:${now}`,
    });

    const waiterId = await resolveTableWaiter(ctx, table, account);
    const guest = args.guestName?.trim().slice(0, 40);
    const totalText = (account.totalCents / 100).toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
    });
    const body = `${guest ? `Pidió ${guest} · ` : ""}Folio ${formatFolio(account.folio)} · ${totalText}`;

    // Notify Cashier / Owner / Manager so Caja sees it immediately
    await emitNotification(ctx, {
      organizationId: table.organizationId,
      locationId: table.locationId,
      kind: "bill",
      title: `${table.tableNumber} pidió la cuenta (QR)`,
      body,
      targetRoles: ["cashier", "owner", "manager"],
      accountId: account._id,
      href: "/cuenta/caja",
      actionLabel: "Ir a caja",
    });

    // Also notify the assigned waiter directly
    if (waiterId) {
      await emitNotification(ctx, {
        organizationId: table.organizationId,
        locationId: table.locationId,
        kind: "bill",
        title: `${table.tableNumber} pidió la cuenta (QR)`,
        body,
        targetStaffId: waiterId,
        accountId: account._id,
        href: `/cuenta/mesero/cuenta/${account._id}`,
        actionLabel: "Abrir cuenta",
      });
    }

    return { folio: account.folio, totalCents: account.totalCents };
  },
});
