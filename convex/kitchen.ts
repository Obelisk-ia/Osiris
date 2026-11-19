import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, safeInteger } from "./model/access";
import { consumeRecipe } from "./model/inventory";
import { emitNotification } from "./model/notifications";
import {
  computeItemProgress,
  getDeliveredQuantity,
  getInventoryConsumedQuantity,
  getPrepReadyQuantity,
  getPrepStartedQuantity,
  resolveStationArea,
  resolveStationRole,
  syncOrderAndAccountTable,
  syncOrderItemStatus,
} from "./model/orders";
import { preparationArea, preparationStatus, staffRole } from "./model/validators";
import {
  areasForStaffRoles,
  PREPARATION_AREA_META,
  type PreparationArea,
  type StaffRole,
} from "../lib/restaurant-roles";

const KITCHEN_ACCESS_ROLES = [
  "chef",
  "bar",
  "bartender",
  "barista",
  "owner",
  "manager",
] as const;

async function requireStationStaff(
  ctx: MutationCtx,
  stationId: Id<"preparationStations">,
) {
  const station = await ctx.db.get("preparationStations", stationId);
  if (!station?.isActive) {
    throw new ConvexError("La estación de preparación no está disponible.");
  }
  const requiredRole = resolveStationRole(station);
  const staff = await requireStaff(ctx, station.organizationId, station.locationId, [
    "owner",
    "manager",
    requiredRole,
  ]);
  return { staff, station };
}

async function accountDestinationLabel(
  ctx: MutationCtx,
  account: Doc<"accounts">,
): Promise<string> {
  if (account.kind === "dine_in" && account.diningTableId) {
    const table = await ctx.db.get("diningTables", account.diningTableId);
    if (table) return table.tableNumber;
  }
  if (account.kind === "takeaway") {
    return account.customerName ? `Para llevar · ${account.customerName}` : "Para llevar";
  }
  if (account.kind === "pickup") {
    return account.customerName ? `Para recoger · ${account.customerName}` : "Para recoger";
  }
  return account.customerName ? `Barra · ${account.customerName}` : `Folio A-${String(account.folio).padStart(4, "0")}`;
}

async function startPreparationUnits(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  prep: Doc<"orderItemPreparations">,
  item: Doc<"orderItems">,
  deltaUnits: number,
  now: number,
): Promise<number> {
  if (item.status === "cancelled" || prep.status === "cancelled") return 0;
  const currentStarted = getPrepStartedQuantity(prep, item.quantity);
  const remaining = item.quantity - currentStarted;
  if (remaining <= 0) return 0;

  const actualDelta = Math.min(deltaUnits, remaining);
  const nextStarted = currentStarted + actualDelta;

  // Deduct inventory only for units not yet consumed by this or any sibling station.
  const alreadyConsumed = getInventoryConsumedQuantity(item);
  if (nextStarted > alreadyConsumed) {
    const consumeDelta = nextStarted - alreadyConsumed;
    const modifiers = await ctx.db
      .query("orderItemModifiers")
      .withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id))
      .take(51);
    if (modifiers.length > 50) {
      throw new ConvexError("El pedido supera el límite de modificadores.");
    }
    await consumeRecipe(
      ctx,
      staff,
      item.dishId,
      consumeDelta,
      `order-item:${item._id}`,
      modifiers,
    );
    await ctx.db.patch("orderItems", item._id, {
      inventoryConsumedAt: item.inventoryConsumedAt ?? now,
      inventoryConsumedQuantity: nextStarted,
    });
  }

  const currentReady = getPrepReadyQuantity(prep, item.quantity);
  await ctx.db.patch("orderItemPreparations", prep._id, {
    startedQuantity: nextStarted,
    readyQuantity: currentReady,
    startedAt: prep.startedAt ?? now,
    startedByStaffId: prep.startedByStaffId ?? staff._id,
    updatedAt: now,
  });
  await syncOrderItemStatus(ctx, item._id, now);
  return actualDelta;
}

async function markPreparationReadyUnits(
  ctx: MutationCtx,
  prep: Doc<"orderItemPreparations">,
  item: Doc<"orderItems">,
  deltaUnits: number,
  now: number,
): Promise<{ marked: number; newlyDeliverableUnits: number }> {
  if (item.status === "cancelled" || prep.status === "cancelled") {
    return { marked: 0, newlyDeliverableUnits: 0 };
  }
  const currentStarted = getPrepStartedQuantity(prep, item.quantity);
  const currentReady = getPrepReadyQuantity(prep, item.quantity);
  const inProgress = currentStarted - currentReady;
  if (inProgress <= 0) return { marked: 0, newlyDeliverableUnits: 0 };

  const prepsBefore = await ctx.db
    .query("orderItemPreparations")
    .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
    .take(10);
  const beforeEffective = computeItemProgress(item, prepsBefore).effectiveReadyQuantity;

  const actualDelta = Math.min(deltaUnits, inProgress);
  const nextReady = currentReady + actualDelta;

  await ctx.db.patch("orderItemPreparations", prep._id, {
    startedQuantity: currentStarted,
    readyQuantity: nextReady,
    readyAt: now,
    updatedAt: now,
  });
  await syncOrderItemStatus(ctx, item._id, now);

  const prepsAfter = await ctx.db
    .query("orderItemPreparations")
    .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
    .take(10);
  const afterEffective = computeItemProgress(item, prepsAfter).effectiveReadyQuantity;
  return {
    marked: actualDelta,
    newlyDeliverableUnits: Math.max(0, afterEffective - beforeEffective),
  };
}

const ticketItemValidator = v.object({
  orderItemId: v.id("orderItems"),
  preparationId: v.id("orderItemPreparations"),
  dishName: v.string(),
  quantity: v.number(),
  startedQuantity: v.number(),
  readyQuantity: v.number(),
  deliveredQuantity: v.number(),
  pendingQuantity: v.number(),
  inProgressQuantity: v.number(),
  readyUndeliveredQuantity: v.number(),
  waitingOnOtherQuantity: v.number(),
  isCancelled: v.boolean(),
  cancelReason: v.string(),
  comments: v.string(),
  modifiers: v.array(v.string()),
  prepStatus: preparationStatus,
  itemStatus: preparationStatus,
  waitingOnOtherStation: v.boolean(),
  otherStations: v.array(
    v.object({
      stationName: v.string(),
      area: preparationArea,
      startedQuantity: v.number(),
      readyQuantity: v.number(),
      status: preparationStatus,
    }),
  ),
});

const ticketValidator = v.object({
  key: v.string(),
  orderId: v.id("orders"),
  stationId: v.id("preparationStations"),
  stationName: v.string(),
  area: preparationArea,
  accountId: v.id("accounts"),
  folio: v.number(),
  kind: v.union(
    v.literal("dine_in"),
    v.literal("counter"),
    v.literal("takeaway"),
    v.literal("pickup"),
  ),
  destinationLabel: v.string(),
  sectionName: v.union(v.string(), v.null()),
  waiterName: v.union(v.string(), v.null()),
  createdAt: v.number(),
  startedAt: v.union(v.number(), v.null()),
  readyAt: v.union(v.number(), v.null()),
  stage: v.union(v.literal("ordered"), v.literal("preparing"), v.literal("ready")),
  hasPending: v.boolean(),
  hasInProgress: v.boolean(),
  hasReadyUndelivered: v.boolean(),
  hasUnackedCancelled: v.boolean(),
  items: v.array(ticketItemValidator),
});

export const snapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    staffName: v.string(),
    roles: v.array(staffRole),
    allowedAreas: v.array(v.object({ area: preparationArea, name: v.string() })),
    autoLateOrderEnabled: v.boolean(),
    autoLateOrderMinutes: v.number(),
    tickets: v.array(ticketValidator),
  }),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, undefined, undefined, KITCHEN_ACCESS_ROLES);
    const [restaurant, location, orderedPreps, preparingPreps, readyPreps, cancelledPreps] =
      await Promise.all([
        ctx.db.get("organizations", staff.organizationId),
        ctx.db.get("locations", staff.locationId),
        ctx.db
          .query("orderItemPreparations")
          .withIndex("by_locationId_and_status", (q) =>
            q.eq("locationId", staff.locationId).eq("status", "ordered"),
          )
          .take(150),
        ctx.db
          .query("orderItemPreparations")
          .withIndex("by_locationId_and_status", (q) =>
            q.eq("locationId", staff.locationId).eq("status", "preparing"),
          )
          .take(150),
        ctx.db
          .query("orderItemPreparations")
          .withIndex("by_locationId_and_status", (q) =>
            q.eq("locationId", staff.locationId).eq("status", "ready"),
          )
          .take(150),
        ctx.db
          .query("orderItemPreparations")
          .withIndex("by_locationId_and_status", (q) =>
            q.eq("locationId", staff.locationId).eq("status", "cancelled"),
          )
          .order("desc")
          .take(60),
      ]);

    const isAdmin = staff.roles.includes("owner") || staff.roles.includes("manager");
    const roleAreas = areasForStaffRoles(staff.roles as readonly StaffRole[]);
    const enabledAreas: PreparationArea[] = isAdmin
      ? ((location?.enabledPreparationAreas && location.enabledPreparationAreas.length > 0
          ? location.enabledPreparationAreas
          : roleAreas) as PreparationArea[])
      : roleAreas;
    const allowedAreaSet = new Set<PreparationArea>(enabledAreas);

    const unackedCancelled = cancelledPreps.filter((p) => p.cancelAcknowledgedAt === undefined);
    const allPreps = [...orderedPreps, ...preparingPreps, ...readyPreps, ...unackedCancelled];

    const stationCache = new Map<Id<"preparationStations">, Doc<"preparationStations"> | null>();
    async function getStation(stationId: Id<"preparationStations">) {
      if (stationCache.has(stationId)) return stationCache.get(stationId) ?? null;
      const doc = await ctx.db.get("preparationStations", stationId);
      stationCache.set(stationId, doc);
      return doc;
    }

    const orderCache = new Map<Id<"orders">, Doc<"orders"> | null>();
    async function getOrder(orderId: Id<"orders">) {
      if (orderCache.has(orderId)) return orderCache.get(orderId) ?? null;
      const doc = await ctx.db.get("orders", orderId);
      orderCache.set(orderId, doc);
      return doc;
    }

    const accountCache = new Map<Id<"accounts">, Doc<"accounts"> | null>();
    async function getAccount(accountId: Id<"accounts">) {
      if (accountCache.has(accountId)) return accountCache.get(accountId) ?? null;
      const doc = await ctx.db.get("accounts", accountId);
      accountCache.set(accountId, doc);
      return doc;
    }

    const tableCache = new Map<Id<"diningTables">, Doc<"diningTables"> | null>();
    async function getTable(tableId: Id<"diningTables">) {
      if (tableCache.has(tableId)) return tableCache.get(tableId) ?? null;
      const doc = await ctx.db.get("diningTables", tableId);
      tableCache.set(tableId, doc);
      return doc;
    }

    const sectionCache = new Map<Id<"sections">, Doc<"sections"> | null>();
    async function getSection(sectionId: Id<"sections">) {
      if (sectionCache.has(sectionId)) return sectionCache.get(sectionId) ?? null;
      const doc = await ctx.db.get("sections", sectionId);
      sectionCache.set(sectionId, doc);
      return doc;
    }

    const staffCache = new Map<Id<"staff">, Doc<"staff"> | null>();
    async function getStaff(staffId: Id<"staff">) {
      if (staffCache.has(staffId)) return staffCache.get(staffId) ?? null;
      const doc = await ctx.db.get("staff", staffId);
      staffCache.set(staffId, doc);
      return doc;
    }

    type TicketBuilder = {
      key: string;
      orderId: Id<"orders">;
      stationId: Id<"preparationStations">;
      stationName: string;
      area: PreparationArea;
      accountId: Id<"accounts">;
      folio: number;
      kind: Doc<"accounts">["kind"];
      destinationLabel: string;
      sectionName: string | null;
      waiterName: string | null;
      createdAt: number;
      startedAt: number | null;
      readyAt: number | null;
      items: Array<{
        orderItemId: Id<"orderItems">;
        preparationId: Id<"orderItemPreparations">;
        dishName: string;
        quantity: number;
        startedQuantity: number;
        readyQuantity: number;
        deliveredQuantity: number;
        pendingQuantity: number;
        inProgressQuantity: number;
        readyUndeliveredQuantity: number;
        waitingOnOtherQuantity: number;
        isCancelled: boolean;
        cancelReason: string;
        comments: string;
        modifiers: string[];
        prepStatus: Doc<"orderItemPreparations">["status"];
        itemStatus: Doc<"orderItems">["status"];
        waitingOnOtherStation: boolean;
        otherStations: Array<{
          stationName: string;
          area: PreparationArea;
          startedQuantity: number;
          readyQuantity: number;
          status: Doc<"orderItemPreparations">["status"];
        }>;
      }>;
    };

    const ticketsMap = new Map<string, TicketBuilder>();

    for (const prep of allPreps) {
      const station = await getStation(prep.stationId);
      if (!station || !station.isActive || station.locationId !== staff.locationId) continue;
      const area = resolveStationArea(station);
      if (!allowedAreaSet.has(area)) continue;

      const item = await ctx.db.get("orderItems", prep.orderItemId);
      if (!item || item.locationId !== staff.locationId) continue;

      const isCancelled = item.status === "cancelled" || prep.status === "cancelled";
      const deliveredQuantity = isCancelled ? 0 : getDeliveredQuantity(item);
      if (!isCancelled && deliveredQuantity >= item.quantity) continue;

      const order = await getOrder(item.orderId);
      if (!order || order.locationId !== staff.locationId) continue;

      const account = await getAccount(order.accountId);
      if (
        !account ||
        account.locationId !== staff.locationId ||
        account.state === "closed" ||
        account.state === "voided"
      ) {
        continue;
      }

      const [mods, siblingPreps] = await Promise.all([
        ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id))
          .take(30),
        ctx.db
          .query("orderItemPreparations")
          .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
          .take(10),
      ]);

      const startedQuantity = getPrepStartedQuantity(prep, item.quantity);
      const readyQuantity = getPrepReadyQuantity(prep, item.quantity);
      const pendingQuantity = isCancelled ? 0 : Math.max(0, item.quantity - startedQuantity);
      const inProgressQuantity = isCancelled ? 0 : Math.max(0, startedQuantity - readyQuantity);
      const readyUndeliveredQuantity = isCancelled ? 0 : Math.max(0, readyQuantity - deliveredQuantity);

      const progress = computeItemProgress(item, siblingPreps);
      const waitingOnOtherQuantity = isCancelled
        ? 0
        : Math.max(0, readyQuantity - progress.effectiveReadyQuantity);

      const otherStations: Array<{
        stationName: string;
        area: PreparationArea;
        startedQuantity: number;
        readyQuantity: number;
        status: Doc<"orderItemPreparations">["status"];
      }> = [];
      for (const sibling of siblingPreps) {
        if (sibling._id === prep._id) continue;
        const sibStation = await getStation(sibling.stationId);
        if (!sibStation) continue;
        otherStations.push({
          stationName: sibStation.name,
          area: resolveStationArea(sibStation),
          startedQuantity: getPrepStartedQuantity(sibling, item.quantity),
          readyQuantity: getPrepReadyQuantity(sibling, item.quantity),
          status: sibling.status,
        });
      }

      const waitingOnOtherStation = waitingOnOtherQuantity > 0;

      const key = `${order._id}::${station._id}`;
      let builder = ticketsMap.get(key);
      if (!builder) {
        let destinationLabel: string;
        let sectionName: string | null = null;
        if (account.kind === "dine_in" && account.diningTableId) {
          const table = await getTable(account.diningTableId);
          destinationLabel = table?.tableNumber ?? `Folio A-${String(account.folio).padStart(4, "0")}`;
          if (table) {
            const section = await getSection(table.sectionId);
            sectionName = section?.name ?? null;
          }
        } else if (account.kind === "takeaway") {
          destinationLabel = account.customerName ? `Para llevar · ${account.customerName}` : "Para llevar";
        } else if (account.kind === "pickup") {
          destinationLabel = account.customerName ? `Para recoger · ${account.customerName}` : "Para recoger";
        } else {
          destinationLabel = account.customerName ? `Barra · ${account.customerName}` : "Barra";
        }

        const waiter = await getStaff(order.takenByStaffId);
        builder = {
          key,
          orderId: order._id,
          stationId: station._id,
          stationName: station.name,
          area,
          accountId: account._id,
          folio: account.folio,
          kind: account.kind,
          destinationLabel,
          sectionName,
          waiterName: waiter?.displayName ?? null,
          createdAt: order._creationTime,
          startedAt: prep.startedAt ?? null,
          readyAt: prep.readyAt ?? null,
          items: [],
        };
        ticketsMap.set(key, builder);
      } else {
        if (prep.startedAt !== undefined) {
          builder.startedAt =
            builder.startedAt === null ? prep.startedAt : Math.min(builder.startedAt, prep.startedAt);
        }
        if (prep.readyAt !== undefined) {
          builder.readyAt =
            builder.readyAt === null ? prep.readyAt : Math.max(builder.readyAt, prep.readyAt);
        }
      }

      builder.items.push({
        orderItemId: item._id,
        preparationId: prep._id,
        dishName: item.dishName,
        quantity: item.quantity,
        startedQuantity,
        readyQuantity,
        deliveredQuantity,
        pendingQuantity,
        inProgressQuantity,
        readyUndeliveredQuantity,
        waitingOnOtherQuantity,
        isCancelled,
        cancelReason: item.cancelReason ?? "",
        comments: item.comments ?? "",
        modifiers: mods.map((m) => m.optionName),
        prepStatus: prep.status,
        itemStatus: progress.status,
        waitingOnOtherStation,
        otherStations,
      });
    }

    const tickets = [...ticketsMap.values()]
      .map((builder) => {
        const hasPending =
          builder.items.some((i) => i.pendingQuantity > 0) ||
          builder.items.some((i) => i.isCancelled && i.startedQuantity === 0);
        const hasInProgress =
          builder.items.some((i) => i.inProgressQuantity > 0) ||
          builder.items.some((i) => i.isCancelled && i.startedQuantity > 0 && i.readyQuantity === 0);
        const hasReadyUndelivered =
          builder.items.some((i) => i.readyUndeliveredQuantity > 0) ||
          builder.items.some((i) => i.isCancelled && i.readyQuantity > 0);
        const hasUnackedCancelled = builder.items.some((i) => i.isCancelled);
        const stage = hasPending
          ? ("ordered" as const)
          : hasInProgress
            ? ("preparing" as const)
            : ("ready" as const);
        return {
          ...builder,
          stage,
          hasPending,
          hasInProgress,
          hasReadyUndelivered,
          hasUnackedCancelled,
        };
      })
      .filter((t) => t.hasPending || t.hasInProgress || t.hasReadyUndelivered || t.hasUnackedCancelled)
      .sort((a, b) => a.createdAt - b.createdAt);

    const chipAreaSet = new Set<PreparationArea>(enabledAreas);
    if (isAdmin) {
      for (const t of tickets) chipAreaSet.add(t.area);
    }
    const allowedAreas = (["kitchen", "bar", "cocktails", "coffee"] as const)
      .filter((area) => chipAreaSet.has(area))
      .map((area) => ({ area, name: PREPARATION_AREA_META[area].name }));

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      staffName: staff.displayName,
      roles: staff.roles,
      allowedAreas,
      autoLateOrderEnabled: location?.autoLateOrderEnabled ?? true,
      autoLateOrderMinutes: location?.autoLateOrderMinutes ?? 20,
      tickets,
    };
  },
});

export const startTicket = mutation({
  args: {
    orderId: v.id("orders"),
    stationId: v.id("preparationStations"),
  },
  returns: v.object({ startedCount: v.number() }),
  handler: async (ctx, args) => {
    const { staff, station } = await requireStationStaff(ctx, args.stationId);
    const order = await ctx.db.get("orders", args.orderId);
    if (!order || order.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos este pedido.");
    }
    const account = await ctx.db.get("accounts", order.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos la cuenta de este pedido.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("La cuenta ya terminó.");
    }

    const now = Date.now();
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);

    let startedCount = 0;
    for (const item of orderItems) {
      if (item.status === "cancelled" || getDeliveredQuantity(item) >= item.quantity) continue;
      const prep = await ctx.db
        .query("orderItemPreparations")
        .withIndex("by_orderItemId_and_stationId", (q) =>
          q.eq("orderItemId", item._id).eq("stationId", station._id),
        )
        .unique();
      if (!prep || prep.status === "cancelled") continue;
      const pending = item.quantity - getPrepStartedQuantity(prep, item.quantity);
      if (pending <= 0) continue;
      const started = await startPreparationUnits(ctx, staff, prep, item, pending, now);
      startedCount += started;
    }

    if (startedCount > 0) {
      await syncOrderAndAccountTable(ctx, order._id, now);
    }

    return { startedCount };
  },
});

export const startItemUnits = mutation({
  args: {
    preparationId: v.id("orderItemPreparations"),
    quantity: v.number(),
  },
  returns: v.object({ startedCount: v.number() }),
  handler: async (ctx, args) => {
    const delta = safeInteger(args.quantity, "Cantidad", 1);
    const prep = await ctx.db.get("orderItemPreparations", args.preparationId);
    if (!prep) throw new ConvexError("No encontramos esta preparación.");
    const { staff } = await requireStationStaff(ctx, prep.stationId);
    const item = await ctx.db.get("orderItems", prep.orderItemId);
    if (!item || item.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos este producto.");
    }
    if (item.status === "cancelled" || prep.status === "cancelled") {
      throw new ConvexError("Este platillo fue cancelado y no se debe preparar.");
    }
    const order = await ctx.db.get("orders", item.orderId);
    const account = order ? await ctx.db.get("accounts", order.accountId) : null;
    if (!order || !account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos la cuenta de este pedido.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("La cuenta ya terminó.");
    }

    const now = Date.now();
    const startedCount = await startPreparationUnits(ctx, staff, prep, item, delta, now);
    if (startedCount > 0) {
      await syncOrderAndAccountTable(ctx, order._id, now);
    }
    return { startedCount };
  },
});

export const markTicketReady = mutation({
  args: {
    orderId: v.id("orders"),
    stationId: v.id("preparationStations"),
  },
  returns: v.object({ readyCount: v.number() }),
  handler: async (ctx, args) => {
    const { staff, station } = await requireStationStaff(ctx, args.stationId);
    const order = await ctx.db.get("orders", args.orderId);
    if (!order || order.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos este pedido.");
    }
    const account = await ctx.db.get("accounts", order.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos la cuenta de este pedido.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("La cuenta ya terminó.");
    }

    const now = Date.now();
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);

    let readyCount = 0;
    const newlyReadyLabels: string[] = [];
    for (const item of orderItems) {
      if (item.status === "cancelled" || getDeliveredQuantity(item) >= item.quantity) continue;
      const prep = await ctx.db
        .query("orderItemPreparations")
        .withIndex("by_orderItemId_and_stationId", (q) =>
          q.eq("orderItemId", item._id).eq("stationId", station._id),
        )
        .unique();
      if (!prep || prep.status === "cancelled") continue;
      const inProgress =
        getPrepStartedQuantity(prep, item.quantity) - getPrepReadyQuantity(prep, item.quantity);
      if (inProgress <= 0) continue;
      const { marked, newlyDeliverableUnits } = await markPreparationReadyUnits(
        ctx,
        prep,
        item,
        inProgress,
        now,
      );
      readyCount += marked;
      if (newlyDeliverableUnits > 0) {
        newlyReadyLabels.push(`${newlyDeliverableUnits} × ${item.dishName}`);
      }
    }

    if (readyCount > 0) {
      await syncOrderAndAccountTable(ctx, order._id, now);
    }

    if (newlyReadyLabels.length > 0) {
      const dest = await accountDestinationLabel(ctx, account);
      await emitNotification(ctx, {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        kind: "ready",
        title: `${dest}: platillos listos para entregar`,
        body: newlyReadyLabels.join(", "),
        targetStaffId: account.assignedStaffId,
        targetRoles: account.assignedStaffId ? [] : ["waiter"],
        accountId: account._id,
        href: `/cuenta/mesero/cuenta/${account._id}`,
        actionLabel: "Ir a entregar",
      });
    }

    return { readyCount };
  },
});

export const markItemReadyUnits = mutation({
  args: {
    preparationId: v.id("orderItemPreparations"),
    quantity: v.number(),
  },
  returns: v.object({ readyCount: v.number() }),
  handler: async (ctx, args) => {
    const delta = safeInteger(args.quantity, "Cantidad", 1);
    const prep = await ctx.db.get("orderItemPreparations", args.preparationId);
    if (!prep) throw new ConvexError("No encontramos esta preparación.");
    const { staff } = await requireStationStaff(ctx, prep.stationId);
    const item = await ctx.db.get("orderItems", prep.orderItemId);
    if (!item || item.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos este producto.");
    }
    if (item.status === "cancelled" || prep.status === "cancelled") {
      throw new ConvexError("Este platillo fue cancelado.");
    }
    const order = await ctx.db.get("orders", item.orderId);
    const account = order ? await ctx.db.get("accounts", order.accountId) : null;
    if (!order || !account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos la cuenta de este pedido.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("La cuenta ya terminó.");
    }

    const now = Date.now();
    const { marked, newlyDeliverableUnits } = await markPreparationReadyUnits(
      ctx,
      prep,
      item,
      delta,
      now,
    );
    if (marked > 0) {
      await syncOrderAndAccountTable(ctx, order._id, now);
    }
    if (newlyDeliverableUnits > 0) {
      const dest = await accountDestinationLabel(ctx, account);
      await emitNotification(ctx, {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        kind: "ready",
        title: `${dest}: platillos listos para entregar`,
        body: `${newlyDeliverableUnits} × ${item.dishName}`,
        targetStaffId: account.assignedStaffId,
        targetRoles: account.assignedStaffId ? [] : ["waiter"],
        accountId: account._id,
        href: `/cuenta/mesero/cuenta/${account._id}`,
        actionLabel: "Ir a entregar",
      });
    }
    return { readyCount: marked };
  },
});

export const acknowledgeCancelledTicket = mutation({
  args: {
    orderId: v.id("orders"),
    stationId: v.id("preparationStations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { staff, station } = await requireStationStaff(ctx, args.stationId);
    const order = await ctx.db.get("orders", args.orderId);
    if (!order || order.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos este pedido.");
    }
    const now = Date.now();
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);
    for (const item of orderItems) {
      const prep = await ctx.db
        .query("orderItemPreparations")
        .withIndex("by_orderItemId_and_stationId", (q) =>
          q.eq("orderItemId", item._id).eq("stationId", station._id),
        )
        .unique();
      if (prep && prep.status === "cancelled" && prep.cancelAcknowledgedAt === undefined) {
        await ctx.db.patch("orderItemPreparations", prep._id, {
          cancelAcknowledgedAt: now,
          updatedAt: now,
        });
      }
    }
    return null;
  },
});
