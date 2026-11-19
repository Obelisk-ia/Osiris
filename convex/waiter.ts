import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import { reconcileCancelledRecipe } from "./model/inventory";
import { emitNotification } from "./model/notifications";
import {
  computeItemProgress,
  getDeliveredQuantity,
  getInventoryConsumedQuantity,
  getPrepReadyQuantity,
  getPrepStartedQuantity,
  resolveStationArea,
  resolveStationRole,
  syncAccountTableStatus,
  syncOrderAndAccountTable,
  syncOrderItemStatus,
} from "./model/orders";
import { accountState, orderStatus, preparationArea, preparationStatus, tableStatus } from "./model/validators";
import {
  PREPARATION_AREAS,
  PREPARATION_AREA_META,
  type PreparationArea,
} from "../lib/restaurant-roles";

const SERVICE_ROLES = ["waiter", "owner", "manager"] as const;
const ALL_AREAS = PREPARATION_AREAS;
const AREA_META = PREPARATION_AREA_META;

const ORDER_STAGE_INDEX: Record<Doc<"orderItems">["status"], number> = {
  ordered: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
  cancelled: 4,
};

async function serviceStaff(ctx: QueryCtx | MutationCtx) {
  return await requireStaff(ctx, undefined, undefined, SERVICE_ROLES);
}

function isManagerOrOwner(staff: Doc<"staff">) {
  return staff.roles.includes("owner") || staff.roles.includes("manager");
}

function resolveDishAreas(dish: Doc<"dishes">): PreparationArea[] {
  if (dish.areas && dish.areas.length > 0) {
    const set = new Set(dish.areas);
    return ALL_AREAS.filter((area) => set.has(area));
  }
  return dish.area === "barra" ? ["bar"] : ["kitchen"];
}

async function activeSectionAssignee(ctx: QueryCtx, sectionId: Id<"sections">): Promise<Id<"staff"> | null> {
  const latest = await ctx.db
    .query("sectionAssignments")
    .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", sectionId))
    .order("desc")
    .take(1);
  const current = latest[0];
  return current && current.endsAt === undefined ? current.assignedStaffId : null;
}

async function ensureStationForArea(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  area: PreparationArea,
): Promise<Id<"preparationStations">> {
  const meta = AREA_META[area];
  const existing = await ctx.db
    .query("preparationStations")
    .withIndex("by_locationId_and_name", (q) => q.eq("locationId", staff.locationId).eq("name", meta.name))
    .unique();
  if (existing) {
    if (!existing.isActive || existing.role !== meta.role || existing.area !== area) {
      await ctx.db.patch("preparationStations", existing._id, {
        isActive: true,
        role: meta.role,
        area,
      });
    }
    return existing._id;
  }
  return await ctx.db.insert("preparationStations", {
    organizationId: staff.organizationId,
    locationId: staff.locationId,
    name: meta.name,
    role: meta.role,
    area,
    isActive: true,
  });
}

async function allocateFolio(ctx: MutationCtx, staff: Doc<"staff">): Promise<number> {
  const counter = await ctx.db
    .query("accountFolioCounters")
    .withIndex("by_locationId", (q) => q.eq("locationId", staff.locationId))
    .unique();
  if (!counter) {
    await ctx.db.insert("accountFolioCounters", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      nextFolio: 2,
      updatedAt: Date.now(),
    });
    return 1;
  }
  const folio = counter.nextFolio;
  await ctx.db.patch("accountFolioCounters", counter._id, {
    nextFolio: folio + 1,
    updatedAt: Date.now(),
  });
  return folio;
}

async function loadAccountItems(ctx: QueryCtx, accountId: Id<"accounts">) {
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .take(50);

  const items: Array<{
    _id: Id<"orderItems">;
    _creationTime: number;
    orderId: Id<"orders">;
    dishId: Id<"dishes">;
    dishName: string;
    quantity: number;
    effectiveReadyQuantity: number;
    deliveredQuantity: number;
    deliverableQuantity: number;
    inventoryConsumedQuantity: number;
    cancelReason: string | null;
    cancelInventoryAction: "none" | "return" | "waste" | null;
    cancelledAt: number | null;
    stationLabel: string;
    unitPriceCents: number;
    lineTotalCents: number;
    comments: string;
    status: Doc<"orderItems">["status"];
    modifiers: Array<{ groupName: string; optionName: string; unitPriceExtraCents: number }>;
    preparations: Array<{
      stationId: Id<"preparationStations">;
      stationName: string;
      area: PreparationArea;
      status: Doc<"orderItemPreparations">["status"];
      startedQuantity: number;
      readyQuantity: number;
    }>;
  }> = [];

  for (const order of orders) {
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);
    for (const item of orderItems) {
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
      const hydratedPreps = (
        await Promise.all(
          preps.map(async (prep) => {
            const station = await ctx.db.get("preparationStations", prep.stationId);
            return {
              stationId: prep.stationId,
              stationName: station?.name ?? "Cocina",
              area: station ? resolveStationArea(station) : ("kitchen" as const),
              status: prep.status,
              startedQuantity: getPrepStartedQuantity(prep, item.quantity),
              readyQuantity: getPrepReadyQuantity(prep, item.quantity),
            };
          }),
        )
      ).sort((a, b) => AREA_SORT_ORDER[a.area] - AREA_SORT_ORDER[b.area]);
      const progress = computeItemProgress(item, preps);
      const stationLabel =
        hydratedPreps.length > 0
          ? hydratedPreps.map((p) => p.stationName).join(" + ")
          : "Cocina";
      items.push({
        _id: item._id,
        _creationTime: item._creationTime,
        orderId: item.orderId,
        dishId: item.dishId,
        dishName: item.dishName,
        quantity: item.quantity,
        effectiveReadyQuantity: progress.effectiveReadyQuantity,
        deliveredQuantity: progress.deliveredQuantity,
        deliverableQuantity: progress.deliverableQuantity,
        inventoryConsumedQuantity: getInventoryConsumedQuantity(item),
        cancelReason: item.cancelReason ?? null,
        cancelInventoryAction: item.cancelInventoryAction ?? null,
        cancelledAt: item.cancelledAt ?? null,
        stationLabel,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents,
        comments: item.comments ?? "",
        status: progress.status,
        modifiers: mods.map((m) => ({
          groupName: m.groupName,
          optionName: m.optionName,
          unitPriceExtraCents: m.unitPriceExtraCents,
        })),
        preparations: hydratedPreps,
      });
    }
  }
  return items;
}

const AREA_SORT_ORDER: Record<PreparationArea, number> = {
  kitchen: 0,
  bar: 1,
  cocktails: 2,
  coffee: 3,
};

const PLATE_SORT_PRIORITY: Record<Doc<"orderItems">["status"], number> = {
  ready: 0,
  preparing: 1,
  ordered: 2,
  delivered: 3,
  cancelled: 4,
};

function summarizeAccount(items: Awaited<ReturnType<typeof loadAccountItems>>, state: Doc<"accounts">["state"]) {
  const activeItems = items.filter((item) => item.status !== "cancelled");
  const progressStep =
    activeItems.length === 0
      ? -1
      : Math.min(...activeItems.map((item) => ORDER_STAGE_INDEX[item.status]));
  const hasReady = activeItems.some((item) => item.deliverableQuantity > 0);
  const hasDelivered = activeItems.some((item) => item.deliveredQuantity > 0);
  const hasUndelivered = activeItems.some((item) => item.deliveredQuantity < item.quantity);
  const deliverableUnits = activeItems.reduce((sum, item) => sum + item.deliverableQuantity, 0);
  const deliveredUnits = activeItems.reduce((sum, item) => sum + item.deliveredQuantity, 0);
  const totalUnits = activeItems.reduce((sum, item) => sum + item.quantity, 0);
  const tableStatus =
    state === "awaiting_payment"
      ? ("payment" as const)
      : hasReady
        ? ("ready" as const)
        : hasDelivered && hasUndelivered
          ? ("partial" as const)
          : ("occupied" as const);

  // Plate-centric checklist data: each active ordered dish appears ONCE with exact
  // counts for delivered / ready / preparing / ordered (no station duplication).
  const plates = activeItems
    .map((item) => {
      const doneOrReady = item.deliveredQuantity + item.deliverableQuantity;
      const remaining = Math.max(0, item.quantity - doneOrReady);
      const maxStarted = Math.max(
        doneOrReady,
        ...item.preparations.map((p) => p.startedQuantity),
      );
      const preparingQuantity = Math.max(0, Math.min(remaining, maxStarted - doneOrReady));
      const pendingQuantity = Math.max(0, remaining - preparingQuantity);
      return {
        orderItemId: item._id,
        dishName: item.dishName,
        quantity: item.quantity,
        effectiveReadyQuantity: item.effectiveReadyQuantity,
        deliveredQuantity: item.deliveredQuantity,
        deliverableQuantity: item.deliverableQuantity,
        preparingQuantity,
        pendingQuantity,
        comments: item.comments,
        modifiersText: item.modifiers.map((m) => m.optionName).join(", "),
        status: item.status,
        progressStep: ORDER_STAGE_INDEX[item.status],
        stationLabel: item.stationLabel,
        stations: item.preparations.map((p) => ({
          stationId: p.stationId,
          stationName: p.stationName,
          area: p.area,
          startedQuantity: p.startedQuantity,
          readyQuantity: p.readyQuantity,
          status: p.status,
        })),
      };
    })
    .sort((a, b) => PLATE_SORT_PRIORITY[a.status] - PLATE_SORT_PRIORITY[b.status]);

  // Group undelivered active items by preparation station for concise progress lines.
  const areaBuckets = new Map<string, { status: string; names: string[] }>();
  for (const item of activeItems) {
    if (item.deliveredQuantity >= item.quantity) continue;
    const label = `${item.quantity} × ${item.dishName}`;
    if (item.preparations.length === 0) {
      const key = "Cocina";
      const existing = areaBuckets.get(key) ?? { status: item.status, names: [] };
      existing.names.push(label);
      areaBuckets.set(key, existing);
    } else {
      for (const prep of item.preparations) {
        const key = `${prep.stationName}::${prep.status}`;
        const existing = areaBuckets.get(key) ?? { status: prep.status, names: [] };
        existing.names.push(label);
        areaBuckets.set(key, existing);
      }
    }
  }
  const areaSummaries = [...areaBuckets.entries()].map(([key, bucket]) => ({
    stationName: key.split("::")[0],
    status: bucket.status,
    itemsText: bucket.names.join(", "),
  }));

  // Station summary retained for API compatibility.
  const sectionMap = new Map<
    Id<"preparationStations">,
    {
      stationId: Id<"preparationStations">;
      stationName: string;
      area: PreparationArea;
      items: Array<{
        orderItemId: Id<"orderItems">;
        dishName: string;
        quantity: number;
        itemStatus: Doc<"orderItems">["status"];
        prepStatus: Doc<"orderItemPreparations">["status"];
        deliverableQuantity: number;
        readyQuantity: number;
        deliveredQuantity: number;
        waitingStations: string[];
      }>;
    }
  >();

  for (const item of activeItems) {
    for (const prep of item.preparations) {
      let bucket = sectionMap.get(prep.stationId);
      if (!bucket) {
        bucket = {
          stationId: prep.stationId,
          stationName: prep.stationName,
          area: prep.area,
          items: [],
        };
        sectionMap.set(prep.stationId, bucket);
      }
      const waitingStations =
        prep.readyQuantity > item.effectiveReadyQuantity
          ? item.preparations
              .filter(
                (other) =>
                  other.stationId !== prep.stationId &&
                  other.readyQuantity < prep.readyQuantity,
              )
              .map((other) => other.stationName)
          : [];
      bucket.items.push({
        orderItemId: item._id,
        dishName: item.dishName,
        quantity: item.quantity,
        itemStatus: item.status,
        prepStatus: prep.status,
        deliverableQuantity: item.deliverableQuantity,
        readyQuantity: prep.readyQuantity,
        deliveredQuantity: item.deliveredQuantity,
        waitingStations,
      });
    }
  }

  const stationSections = [...sectionMap.values()]
    .map((bucket) => {
      const deliverableCount = bucket.items.filter((i) => i.deliverableQuantity > 0).length;
      const deliveredCount = bucket.items.filter((i) => i.deliveredQuantity >= i.quantity).length;
      const waitingItems = bucket.items.filter((i) => i.waitingStations.length > 0);
      const waitingStationNames = [
        ...new Set(waitingItems.flatMap((i) => i.waitingStations)),
      ];
      const allDelivered = bucket.items.length > 0 && deliveredCount === bucket.items.length;
      const anyPreparingOrReady = bucket.items.some(
        (i) => i.deliveredQuantity < i.quantity && i.prepStatus !== "ordered",
      );
      const status: Doc<"orderItems">["status"] = allDelivered
        ? "delivered"
        : deliverableCount > 0
          ? "ready"
          : anyPreparingOrReady
            ? "preparing"
            : "ordered";
      return {
        stationId: bucket.stationId,
        stationName: bucket.stationName,
        area: bucket.area,
        status,
        progressStep: ORDER_STAGE_INDEX[status],
        deliverableCount,
        waitingOnOtherCount: waitingItems.length,
        waitingStationNames,
        deliveredCount,
        totalCount: bucket.items.length,
        items: bucket.items.map((i) => ({
          orderItemId: i.orderItemId,
          dishName: i.dishName,
          quantity: i.quantity,
          itemStatus: i.itemStatus,
          prepStatus: i.prepStatus,
          waitingStations: i.waitingStations,
        })),
      };
    })
    .sort((a, b) => AREA_SORT_ORDER[a.area] - AREA_SORT_ORDER[b.area]);

  return {
    progressStep,
    hasReady,
    hasDelivered,
    hasUndelivered,
    deliverableUnits,
    deliveredUnits,
    totalUnits,
    tableStatus,
    plates,
    areaSummaries,
    stationSections,
  };
}

async function recalculateAccountTotal(ctx: MutationCtx, accountId: Id<"accounts">): Promise<number> {
  const items = await loadAccountItems(ctx, accountId);
  const totalCents = items
    .filter((item) => item.status !== "cancelled")
    .reduce((sum, item) => sum + item.lineTotalCents, 0);
  await ctx.db.patch("accounts", accountId, { totalCents, updatedAt: Date.now() });
  return totalCents;
}

async function assertTableVisibleToStaff(
  ctx: QueryCtx,
  staff: Doc<"staff">,
  table: Doc<"diningTables">,
) {
  if (isManagerOrOwner(staff)) return;
  const assignee = await activeSectionAssignee(ctx, table.sectionId);
  if (table.currentAccountId) {
    const acc = await ctx.db.get("accounts", table.currentAccountId);
    if (acc && (acc.state === "open" || acc.state === "awaiting_payment")) {
      if (acc.assignedStaffId && acc.assignedStaffId !== staff._id) {
        throw new ConvexError("Esta mesa la está atendiendo otro mesero.");
      }
      return;
    }
  }
  if (assignee !== null && assignee !== staff._id) {
    throw new ConvexError("Esta mesa pertenece a una sección asignada a otro mesero.");
  }
}

const areaSummaryValidator = v.object({
  stationName: v.string(),
  status: v.string(),
  itemsText: v.string(),
});

const stationSectionItemValidator = v.object({
  orderItemId: v.id("orderItems"),
  dishName: v.string(),
  quantity: v.number(),
  itemStatus: orderStatus,
  prepStatus: preparationStatus,
  waitingStations: v.array(v.string()),
});

const stationSectionValidator = v.object({
  stationId: v.id("preparationStations"),
  stationName: v.string(),
  area: preparationArea,
  status: orderStatus,
  progressStep: v.number(),
  deliverableCount: v.number(),
  waitingOnOtherCount: v.number(),
  waitingStationNames: v.array(v.string()),
  deliveredCount: v.number(),
  totalCount: v.number(),
  items: v.array(stationSectionItemValidator),
});

const plateStationValidator = v.object({
  stationId: v.id("preparationStations"),
  stationName: v.string(),
  area: preparationArea,
  startedQuantity: v.number(),
  readyQuantity: v.number(),
  status: preparationStatus,
});

const plateSummaryValidator = v.object({
  orderItemId: v.id("orderItems"),
  dishName: v.string(),
  quantity: v.number(),
  effectiveReadyQuantity: v.number(),
  deliveredQuantity: v.number(),
  deliverableQuantity: v.number(),
  preparingQuantity: v.number(),
  pendingQuantity: v.number(),
  comments: v.string(),
  modifiersText: v.string(),
  status: orderStatus,
  progressStep: v.number(),
  stationLabel: v.string(),
  stations: v.array(plateStationValidator),
});

const busyTableValidator = v.object({
  tableId: v.id("diningTables"),
  tableNumber: v.string(),
  seatCount: v.number(),
  sectionName: v.string(),
  accountId: v.id("accounts"),
  folio: v.number(),
  accountState,
  openedAt: v.number(),
  totalCents: v.number(),
  status: v.union(v.literal("occupied"), v.literal("partial"), v.literal("ready"), v.literal("payment")),
  progressStep: v.number(),
  itemCount: v.number(),
  deliverableUnits: v.number(),
  deliveredUnits: v.number(),
  totalUnits: v.number(),
  hasReady: v.boolean(),
  hasUndelivered: v.boolean(),
  assignedStaffName: v.union(v.string(), v.null()),
  plates: v.array(plateSummaryValidator),
  areaSummaries: v.array(areaSummaryValidator),
  stationSections: v.array(stationSectionValidator),
});

const freeTableValidator = v.object({
  tableId: v.id("diningTables"),
  tableNumber: v.string(),
  seatCount: v.number(),
  sectionName: v.string(),
  isUnassignedSection: v.boolean(),
});

export const tablesSnapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    staffId: v.id("staff"),
    staffName: v.string(),
    busyTables: v.array(busyTableValidator),
    freeTables: v.array(freeTableValidator),
  }),
  handler: async (ctx) => {
    const staff = await serviceStaff(ctx);
    const [restaurant, location, sections, tables, staffRows] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("diningTables")
        .withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", true),
        )
        .take(120),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId))
        .take(100),
    ]);

    const sectionMap = new Map(sections.map((s) => [s._id, s] as const));
    const staffNames = new Map(staffRows.map((s) => [s._id, s.displayName] as const));
    const sectionAssignees = new Map<Id<"sections">, Id<"staff"> | null>();
    for (const section of sections) {
      sectionAssignees.set(section._id, await activeSectionAssignee(ctx, section._id));
    }

    const busyTables: Array<{
      tableId: Id<"diningTables">;
      tableNumber: string;
      seatCount: number;
      sectionName: string;
      accountId: Id<"accounts">;
      folio: number;
      accountState: Doc<"accounts">["state"];
      openedAt: number;
      totalCents: number;
      status: "occupied" | "partial" | "ready" | "payment";
      progressStep: number;
      itemCount: number;
      deliverableUnits: number;
      deliveredUnits: number;
      totalUnits: number;
      hasReady: boolean;
      hasUndelivered: boolean;
      assignedStaffName: string | null;
      plates: ReturnType<typeof summarizeAccount>["plates"];
      areaSummaries: Array<{ stationName: string; status: string; itemsText: string }>;
      stationSections: ReturnType<typeof summarizeAccount>["stationSections"];
    }> = [];

    const freeTables: Array<{
      tableId: Id<"diningTables">;
      tableNumber: string;
      seatCount: number;
      sectionName: string;
      isUnassignedSection: boolean;
    }> = [];

    const admin = isManagerOrOwner(staff);

    for (const table of tables) {
      const section = sectionMap.get(table.sectionId);
      if (!section) continue;
      const sectionAssignee = sectionAssignees.get(section._id) ?? null;

      let activeAccount: Doc<"accounts"> | null = null;
      if (table.currentAccountId) {
        const acc = await ctx.db.get("accounts", table.currentAccountId);
        if (acc && (acc.state === "open" || acc.state === "awaiting_payment")) {
          activeAccount = acc;
        }
      }

      if (activeAccount) {
        // Show if assigned to this waiter, unassigned, or viewer is owner/manager.
        const ownedByOther =
          !admin &&
          activeAccount.assignedStaffId !== undefined &&
          activeAccount.assignedStaffId !== staff._id;
        if (ownedByOther) continue;

        const items = await loadAccountItems(ctx, activeAccount._id);
        const summary = summarizeAccount(items, activeAccount.state);
        busyTables.push({
          tableId: table._id,
          tableNumber: table.tableNumber,
          seatCount: table.seatCount,
          sectionName: section.name,
          accountId: activeAccount._id,
          folio: activeAccount.folio,
          accountState: activeAccount.state,
          openedAt: activeAccount._creationTime,
          totalCents: activeAccount.totalCents,
          status: summary.tableStatus,
          progressStep: summary.progressStep,
          itemCount: summary.totalUnits,
          deliverableUnits: summary.deliverableUnits,
          deliveredUnits: summary.deliveredUnits,
          totalUnits: summary.totalUnits,
          hasReady: summary.hasReady,
          hasUndelivered: summary.hasUndelivered,
          assignedStaffName: activeAccount.assignedStaffId
            ? staffNames.get(activeAccount.assignedStaffId) ?? null
            : null,
          plates: summary.plates,
          areaSummaries: summary.areaSummaries,
          stationSections: summary.stationSections,
        });
      } else {
        // Free table: visible if section is assigned to this waiter OR no one is in charge.
        if (!admin && sectionAssignee !== null && sectionAssignee !== staff._id) {
          continue;
        }
        freeTables.push({
          tableId: table._id,
          tableNumber: table.tableNumber,
          seatCount: table.seatCount,
          sectionName: section.name,
          isUnassignedSection: sectionAssignee === null,
        });
      }
    }

    const priority = { ready: 0, partial: 1, occupied: 2, payment: 3 };
    busyTables.sort((a, b) => priority[a.status] - priority[b.status] || a.openedAt - b.openedAt);
    freeTables.sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, "es-MX", { numeric: true }));

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      staffId: staff._id,
      staffName: staff.displayName,
      busyTables,
      freeTables,
    };
  },
});

const orderItemView = v.object({
  _id: v.id("orderItems"),
  _creationTime: v.number(),
  orderId: v.id("orders"),
  dishId: v.id("dishes"),
  dishName: v.string(),
  quantity: v.number(),
  effectiveReadyQuantity: v.number(),
  deliveredQuantity: v.number(),
  deliverableQuantity: v.number(),
  inventoryConsumedQuantity: v.number(),
  cancelReason: v.union(v.string(), v.null()),
  cancelInventoryAction: v.union(v.literal("none"), v.literal("return"), v.literal("waste"), v.null()),
  cancelledAt: v.union(v.number(), v.null()),
  stationLabel: v.string(),
  unitPriceCents: v.number(),
  lineTotalCents: v.number(),
  comments: v.string(),
  status: orderStatus,
  modifiers: v.array(
    v.object({
      groupName: v.string(),
      optionName: v.string(),
      unitPriceExtraCents: v.number(),
    }),
  ),
  preparations: v.array(
    v.object({
      stationId: v.id("preparationStations"),
      stationName: v.string(),
      area: preparationArea,
      status: preparationStatus,
      startedQuantity: v.number(),
      readyQuantity: v.number(),
    }),
  ),
});

export const orderWorkspace = query({
  args: {
    tableId: v.optional(v.id("diningTables")),
    accountId: v.optional(v.id("accounts")),
  },
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    canTakeOrder: v.boolean(),
    canManageAccount: v.boolean(),
    table: v.union(
      v.null(),
      v.object({
        _id: v.id("diningTables"),
        tableNumber: v.string(),
        seatCount: v.number(),
        sectionName: v.string(),
      }),
    ),
    account: v.union(
      v.null(),
      v.object({
        _id: v.id("accounts"),
        folio: v.number(),
        kind: v.union(v.literal("dine_in"), v.literal("counter"), v.literal("takeaway"), v.literal("pickup")),
        state: accountState,
        openedAt: v.number(),
        totalCents: v.number(),
        assignedStaffId: v.union(v.id("staff"), v.null()),
        assignedStaffName: v.union(v.string(), v.null()),
        customerName: v.union(v.string(), v.null()),
        customerPhone: v.union(v.string(), v.null()),
        promisedAt: v.union(v.number(), v.null()),
        progressStep: v.number(),
        tableStatus: v.union(v.literal("occupied"), v.literal("partial"), v.literal("ready"), v.literal("payment")),
        deliverableUnits: v.number(),
        deliveredUnits: v.number(),
        totalUnits: v.number(),
        hasReady: v.boolean(),
        hasUndelivered: v.boolean(),
        plates: v.array(plateSummaryValidator),
        stationSections: v.array(stationSectionValidator),
        items: v.array(orderItemView),
      }),
    ),
    freeTables: v.array(
      v.object({
        _id: v.id("diningTables"),
        tableNumber: v.string(),
        sectionName: v.string(),
      }),
    ),
    activeWaiters: v.array(
      v.object({
        _id: v.id("staff"),
        displayName: v.string(),
      }),
    ),
    categories: v.array(v.object({ _id: v.id("dishCategories"), name: v.string() })),
    dishes: v.array(
      v.object({
        _id: v.id("dishes"),
        name: v.string(),
        description: v.string(),
        priceCents: v.number(),
        categoryId: v.union(v.id("dishCategories"), v.null()),
        areas: v.array(preparationArea),
        photoUrl: v.union(v.string(), v.null()),
        soldOut: v.boolean(),
        modifierGroupIds: v.array(v.id("modifierGroups")),
      }),
    ),
    modifierGroups: v.array(
      v.object({
        _id: v.id("modifierGroups"),
        name: v.string(),
        required: v.boolean(),
        multi: v.boolean(),
        options: v.array(
          v.object({
            _id: v.id("modifierOptions"),
            name: v.string(),
            priceExtraCents: v.number(),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const [restaurant, location] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
    ]);

    let table: Doc<"diningTables"> | null = null;
    let account: Doc<"accounts"> | null = null;

    if (args.accountId) {
      const found = await ctx.db.get("accounts", args.accountId);
      if (!found || found.locationId !== staff.locationId) {
        throw new ConvexError("No encontramos esta cuenta.");
      }
      account = found;
      if (found.diningTableId) {
        const t = await ctx.db.get("diningTables", found.diningTableId);
        if (t && t.locationId === staff.locationId) table = t;
      }
    } else if (args.tableId) {
      const found = await ctx.db.get("diningTables", args.tableId);
      if (!found || !found.isActive || found.locationId !== staff.locationId) {
        throw new ConvexError("No encontramos esa mesa.");
      }
      await assertTableVisibleToStaff(ctx, staff, found);
      table = found;
      if (found.currentAccountId) {
        const acc = await ctx.db.get("accounts", found.currentAccountId);
        if (acc && (acc.state === "open" || acc.state === "awaiting_payment")) {
          account = acc;
        }
      }
    } else {
      throw new ConvexError("Selecciona una mesa o cuenta para continuar.");
    }

    const section = table ? await ctx.db.get("sections", table.sectionId) : null;
    const assignedStaffDoc = account?.assignedStaffId
      ? await ctx.db.get("staff", account.assignedStaffId)
      : null;

    const isWaiter = staff.roles.includes("waiter");
    const ownsAccount =
      !account || !account.assignedStaffId || account.assignedStaffId === staff._id;
    const canManageAccount = (isWaiter && ownsAccount) || isManagerOrOwner(staff);
    const canTakeOrder =
      canManageAccount && (!account || account.state === "open");

    const accountItems = account ? await loadAccountItems(ctx, account._id) : [];
    const summary = account ? summarizeAccount(accountItems, account.state) : null;

    // Load live shared menu
    const [categories, dishes, groups, balances, allSections, allTables, locationStaff] = await Promise.all([
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
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(200),
      ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", staff.locationId))
        .take(50),
      ctx.db
        .query("diningTables")
        .withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", true),
        )
        .take(120),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", true),
        )
        .take(100),
    ]);
    const activeWaiters = locationStaff
      .filter((member) => member.roles.includes("waiter"))
      .map((member) => ({ _id: member._id, displayName: member.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es-MX"));

    const autoSoldOut = location?.autoSoldOut ?? true;
    const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));
    const activeCategories = categories.filter((c) => c.isActive);
    const activeCategoryIds = new Set(activeCategories.map((c) => c._id));

    const menuDishes = await Promise.all(
      dishes
        .filter((d) => (d.isPublished ?? true) && (!d.categoryId || activeCategoryIds.has(d.categoryId)))
        .map(async (dish) => {
          const [photoUrl, modLinks, recipeRows] = await Promise.all([
            dish.photoId ? ctx.storage.getUrl(dish.photoId) : Promise.resolve(null),
            ctx.db
              .query("dishModifierGroups")
              .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dish._id))
              .take(30),
            autoSoldOut
              ? ctx.db
                  .query("recipeIngredients")
                  .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
                  .take(50)
              : Promise.resolve([]),
          ]);
          const soldByIngredient =
            autoSoldOut &&
            recipeRows.some((row) => (balanceMap.get(row.inventoryItemId) ?? 0) <= 0);
          return {
            _id: dish._id,
            name: dish.name,
            description: dish.description ?? "",
            priceCents: dish.priceCents,
            categoryId: dish.categoryId ?? null,
            areas: resolveDishAreas(dish),
            photoUrl,
            soldOut: !dish.isAvailable || soldByIngredient,
            modifierGroupIds: modLinks
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => l.modifierGroupId),
          };
        }),
    );

    const modifierGroupViews = await Promise.all(
      groups
        .filter((g) => g.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(async (group) => {
          const opts = await ctx.db
            .query("modifierOptions")
            .withIndex("by_modifierGroupId_and_name", (q) => q.eq("modifierGroupId", group._id))
            .take(50);
          return {
            _id: group._id,
            name: group.name,
            required: group.minSelections > 0,
            multi: group.maxSelections === undefined || group.maxSelections > 1,
            options: opts
              .filter((o) => o.isActive)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((o) => ({
                _id: o._id,
                name: o.name,
                priceExtraCents: o.priceExtraCents,
              })),
          };
        }),
    );

    const sectionNameMap = new Map(allSections.map((s) => [s._id, s.name] as const));
    const freeTables = [];
    for (const candidate of allTables) {
      if (table && candidate._id === table._id) continue;
      if (candidate.currentAccountId) {
        const candidateAcc = await ctx.db.get("accounts", candidate.currentAccountId);
        if (candidateAcc && (candidateAcc.state === "open" || candidateAcc.state === "awaiting_payment")) {
          continue;
        }
      }
      freeTables.push({
        _id: candidate._id,
        tableNumber: candidate.tableNumber,
        sectionName: sectionNameMap.get(candidate.sectionId) ?? "Sección",
      });
    }

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      canTakeOrder,
      canManageAccount,
      table: table
        ? {
            _id: table._id,
            tableNumber: table.tableNumber,
            seatCount: table.seatCount,
            sectionName: section?.name ?? "Sección",
          }
        : null,
      account: account && summary
        ? {
            _id: account._id,
            folio: account.folio,
            kind: account.kind,
            state: account.state,
            openedAt: account._creationTime,
            totalCents: account.totalCents,
            assignedStaffId: account.assignedStaffId ?? null,
            assignedStaffName: assignedStaffDoc?.displayName ?? null,
            customerName: account.customerName ?? null,
            customerPhone: account.customerPhone ?? null,
            promisedAt: account.promisedAt ?? null,
            progressStep: summary.progressStep,
            tableStatus: summary.tableStatus,
            deliverableUnits: summary.deliverableUnits,
            deliveredUnits: summary.deliveredUnits,
            totalUnits: summary.totalUnits,
            hasReady: summary.hasReady,
            hasUndelivered: summary.hasUndelivered,
            plates: summary.plates,
            stationSections: summary.stationSections,
            items: accountItems,
          }
        : null,
      freeTables,
      activeWaiters,
      categories: activeCategories.map((c) => ({ _id: c._id, name: c.name })),
      dishes: menuDishes,
      modifierGroups: modifierGroupViews,
    };
  },
});

export const takeoutSnapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    accounts: v.array(
      v.object({
        _id: v.id("accounts"),
        folio: v.number(),
        kind: v.union(v.literal("counter"), v.literal("takeaway"), v.literal("pickup")),
        state: accountState,
        stage: v.union(v.literal("nuevo"), v.literal("preparando"), v.literal("listo"), v.literal("entregado")),
        customerName: v.string(),
        customerPhone: v.union(v.string(), v.null()),
        promisedAt: v.union(v.number(), v.null()),
        totalCents: v.number(),
        openedAt: v.number(),
        itemsSummary: v.string(),
        hasItems: v.boolean(),
        hasUndelivered: v.boolean(),
        deliverableUnits: v.number(),
        deliveredUnits: v.number(),
        totalUnits: v.number(),
        isPaid: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const staff = await serviceStaff(ctx);
    const [restaurant, location, openAccounts, paymentAccounts, closedAccounts] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) => q.eq("locationId", staff.locationId).eq("state", "open"))
        .order("desc")
        .take(50),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) =>
          q.eq("locationId", staff.locationId).eq("state", "awaiting_payment"),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) => q.eq("locationId", staff.locationId).eq("state", "closed"))
        .order("desc")
        .take(40),
    ]);

    // Show today's paid takeout orders in the Entregado column (last 18 hours window).
    const todayCutoff = Date.now() - 18 * 60 * 60 * 1000;
    const recentClosed = closedAccounts.filter(
      (acc) => acc.kind !== "dine_in" && (acc.closedAt ?? acc.updatedAt) >= todayCutoff,
    );

    const admin = isManagerOrOwner(staff);
    const relevant = [...openAccounts, ...paymentAccounts, ...recentClosed].filter((acc) => {
      if (acc.kind === "dine_in") return false;
      if (!admin && acc.assignedStaffId && acc.assignedStaffId !== staff._id) return false;
      return true;
    });

    const accounts = await Promise.all(
      relevant.map(async (acc) => {
        const items = await loadAccountItems(ctx, acc._id);
        const activeItems = items.filter((i) => i.status !== "cancelled");
        const summary = summarizeAccount(items, acc.state);
        const isPaid = acc.state === "closed";
        const stage =
          isPaid || (activeItems.length > 0 && !summary.hasUndelivered)
            ? ("entregado" as const)
            : summary.deliverableUnits > 0
              ? ("listo" as const)
              : activeItems.some((i) => i.status === "preparing" || i.deliveredQuantity > 0)
                ? ("preparando" as const)
                : ("nuevo" as const);
        return {
          _id: acc._id,
          folio: acc.folio,
          kind: acc.kind as "counter" | "takeaway" | "pickup",
          state: acc.state,
          stage,
          customerName: acc.customerName ?? (acc.kind === "counter" ? "Barra" : "Cliente"),
          customerPhone: acc.customerPhone ?? null,
          promisedAt: acc.promisedAt ?? null,
          totalCents: acc.totalCents,
          openedAt: acc._creationTime,
          itemsSummary: activeItems.map((i) => `${i.quantity} × ${i.dishName}`).join(", "),
          hasItems: activeItems.length > 0,
          hasUndelivered: summary.hasUndelivered,
          deliverableUnits: summary.deliverableUnits,
          deliveredUnits: summary.deliveredUnits,
          totalUnits: summary.totalUnits,
          isPaid,
        };
      }),
    );

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      accounts,
    };
  },
});

const orderLineInput = v.object({
  dishId: v.id("dishes"),
  quantity: v.number(),
  comments: v.optional(v.string()),
  modifierOptionIds: v.array(v.id("modifierOptions")),
});

export const submitOrder = mutation({
  args: {
    tableId: v.optional(v.id("diningTables")),
    accountId: v.optional(v.id("accounts")),
    items: v.array(orderLineInput),
  },
  returns: v.object({
    accountId: v.id("accounts"),
    orderId: v.id("orders"),
    stationNames: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    if (args.items.length < 1 || args.items.length > 50) {
      throw new ConvexError("Agrega entre 1 y 50 productos a la orden.");
    }

    const location = await ctx.db.get("locations", staff.locationId);
    const autoSoldOut = location?.autoSoldOut ?? true;

    let account: Doc<"accounts"> | null = null;
    let table: Doc<"diningTables"> | null = null;

    if (args.accountId) {
      const found = await ctx.db.get("accounts", args.accountId);
      if (!found || found.locationId !== staff.locationId) {
        throw new ConvexError("No encontramos esta cuenta.");
      }
      if (found.state !== "open") {
        throw new ConvexError("Esta cuenta no admite nuevos pedidos en su estado actual.");
      }
      if (!isManagerOrOwner(staff) && found.assignedStaffId && found.assignedStaffId !== staff._id) {
        throw new ConvexError("Esta cuenta la atiende otro mesero.");
      }
      account = found;
      if (found.diningTableId) {
        table = await ctx.db.get("diningTables", found.diningTableId);
      }
    } else if (args.tableId) {
      const found = await ctx.db.get("diningTables", args.tableId);
      if (!found || !found.isActive || found.locationId !== staff.locationId) {
        throw new ConvexError("No encontramos esa mesa.");
      }
      await assertTableVisibleToStaff(ctx, staff, found);
      table = found;
      if (found.currentAccountId) {
        const existing = await ctx.db.get("accounts", found.currentAccountId);
        if (existing && existing.state === "open") {
          account = existing;
        } else if (existing && existing.state === "awaiting_payment") {
          throw new ConvexError("Esta mesa ya pidió la cuenta. Vuelve a abrirla para agregar productos.");
        }
      }
    } else {
      throw new ConvexError("Indica una mesa o cuenta para tomar la orden.");
    }

    // Validate all dishes & modifiers before writing anything.
    const balances = autoSoldOut
      ? await ctx.db
          .query("inventoryBalances")
          .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
          .take(200)
      : [];
    const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));

    const preparedLines: Array<{
      dish: Doc<"dishes">;
      areas: PreparationArea[];
      quantity: number;
      comments?: string;
      mods: Array<{
        option: Doc<"modifierOptions">;
        groupName: string;
        recipeDeltas: Array<{ inventoryItemId: Id<"inventoryItems">; quantityDeltaMicros: number }>;
      }>;
    }> = [];

    for (const line of args.items) {
      const quantity = safeInteger(line.quantity, "Cantidad", 1);
      if (quantity > 99) throw new ConvexError("La cantidad máxima por línea es 99.");
      const dish = await ctx.db.get("dishes", line.dishId);
      if (!dish || dish.organizationId !== staff.organizationId || !(dish.isPublished ?? true)) {
        throw new ConvexError("Uno de los platillos ya no está disponible en el menú.");
      }
      if (!dish.isAvailable) {
        throw new ConvexError(`${dish.name} está agotado y no se puede ordenar.`);
      }
      if (autoSoldOut) {
        const recipe = await ctx.db
          .query("recipeIngredients")
          .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
          .take(50);
        if (recipe.some((row) => (balanceMap.get(row.inventoryItemId) ?? 0) <= 0)) {
          throw new ConvexError(`${dish.name} está agotado por falta de insumos.`);
        }
      }

      const uniqueOptionIds = [...new Set(line.modifierOptionIds)];
      const mods: Array<{
        option: Doc<"modifierOptions">;
        groupName: string;
        recipeDeltas: Array<{ inventoryItemId: Id<"inventoryItems">; quantityDeltaMicros: number }>;
      }> = [];
      const selectedByGroup = new Map<Id<"modifierGroups">, number>();

      for (const optId of uniqueOptionIds) {
        const opt = await ctx.db.get("modifierOptions", optId);
        if (!opt || !opt.isActive || opt.organizationId !== staff.organizationId) {
          throw new ConvexError("Una opción de modificador seleccionada no es válida.");
        }
        const group = await ctx.db.get("modifierGroups", opt.modifierGroupId);
        if (!group || group.organizationId !== staff.organizationId) {
          throw new ConvexError("Un grupo de modificadores no es válido.");
        }
        selectedByGroup.set(group._id, (selectedByGroup.get(group._id) ?? 0) + 1);
        const modRecipes = await ctx.db
          .query("modifierRecipeIngredients")
          .withIndex("by_modifierOptionId_and_inventoryItemId", (q) => q.eq("modifierOptionId", opt._id))
          .take(20);
        mods.push({
          option: opt,
          groupName: group.name,
          recipeDeltas: modRecipes.map((r) => ({
            inventoryItemId: r.inventoryItemId,
            quantityDeltaMicros: r.quantityDeltaMicros,
          })),
        });
      }

      // Check required modifier groups on this dish.
      const dishModLinks = await ctx.db
        .query("dishModifierGroups")
        .withIndex("by_dishId_and_modifierGroupId", (q) => q.eq("dishId", dish._id))
        .take(30);
      for (const link of dishModLinks) {
        const group = await ctx.db.get("modifierGroups", link.modifierGroupId);
        if (group?.isActive && group.minSelections > 0) {
          const picked = selectedByGroup.get(group._id) ?? 0;
          if (picked < group.minSelections) {
            throw new ConvexError(`Elige una opción obligatoria de ${group.name} para ${dish.name}.`);
          }
        }
      }

      preparedLines.push({
        dish,
        areas: resolveDishAreas(dish),
        quantity,
        comments: line.comments?.trim().slice(0, 140) || undefined,
        mods,
      });
    }

    const now = Date.now();
    let accountId: Id<"accounts">;
    if (!account) {
      if (!table) throw new ConvexError("No encontramos la mesa.");
      const folio = await allocateFolio(ctx, staff);
      accountId = await ctx.db.insert("accounts", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        sectionId: table.sectionId,
        diningTableId: table._id,
        assignedStaffId: staff._id,
        openedByStaffId: staff._id,
        kind: "dine_in",
        state: "open",
        folio,
        version: 1,
        requestId: `acc:${table._id}:${now}`,
        totalCents: 0,
        updatedAt: now,
      });
      await ctx.db.patch("diningTables", table._id, {
        currentAccountId: accountId,
        status: "occupied",
        assignedStaffId: staff._id,
      });
    } else {
      accountId = account._id;
      if (!account.assignedStaffId && staff.roles.includes("waiter")) {
        await ctx.db.patch("accounts", account._id, { assignedStaffId: staff._id, updatedAt: now });
      }
      if (table && table.status === "empty") {
        await ctx.db.patch("diningTables", table._id, { status: "occupied" });
      }
    }

    const orderId = await ctx.db.insert("orders", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      accountId,
      diningTableId: table?._id,
      status: "ordered",
      takenByStaffId: staff._id,
      updatedAt: now,
    });

    const stationNames = new Set<string>();
    const stationCache = new Map<PreparationArea, Id<"preparationStations">>();

    for (const line of preparedLines) {
      const orderItemId = await ctx.db.insert("orderItems", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        orderId,
        dishId: line.dish._id,
        quantity: line.quantity,
        unitPriceCents: line.dish.priceCents,
        dishName: line.dish.name,
        comments: line.comments,
        status: "ordered",
        deliveredQuantity: 0,
        inventoryConsumedQuantity: 0,
        updatedAt: now,
      });

      for (const mod of line.mods) {
        await ctx.db.insert("orderItemModifiers", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          orderItemId,
          dishId: line.dish._id,
          modifierOptionId: mod.option._id,
          groupName: mod.groupName,
          optionName: mod.option.name,
          quantity: 1,
          unitPriceExtraCents: mod.option.priceExtraCents,
          recipeDeltas: mod.recipeDeltas,
        });
      }

      for (const area of line.areas) {
        let stationId = stationCache.get(area);
        if (!stationId) {
          stationId = await ensureStationForArea(ctx, staff, area);
          stationCache.set(area, stationId);
        }
        stationNames.add(AREA_META[area].name);
        await ctx.db.insert("orderItemPreparations", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          orderItemId,
          stationId,
          status: "ordered",
          startedQuantity: 0,
          readyQuantity: 0,
          updatedAt: now,
        });
      }
    }

    await recalculateAccountTotal(ctx, accountId);
    await syncAccountTableStatus(ctx, accountId, now);

    // Notify ONLY the specific station roles that received items in this order.
    const destLabel = table
      ? table.tableNumber
      : account?.customerName
        ? `${account.kind === "takeaway" ? "Para llevar" : account.kind === "pickup" ? "Para recoger" : "Barra"} · ${account.customerName}`
        : "Pedido sin mesa";
    const itemsByRole = new Map<Doc<"preparationStations">["role"], string[]>();
    for (const line of preparedLines) {
      for (const area of line.areas) {
        const role = AREA_META[area].role;
        const list = itemsByRole.get(role) ?? [];
        list.push(`${line.quantity} × ${line.dish.name}`);
        itemsByRole.set(role, list);
      }
    }
    for (const [role, labels] of itemsByRole) {
      await emitNotification(ctx, {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        kind: "order",
        title: `Pedido nuevo: ${destLabel}`,
        body: labels.join(", "),
        targetRoles: [role],
        accountId,
        href: "/cuenta/cocina",
        actionLabel: "Ver pedidos",
      });
    }

    return {
      accountId,
      orderId,
      stationNames: [...stationNames],
    };
  },
});

export const updateOrderItemQuantity = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    quantity: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const item = await ctx.db.get("orderItems", args.orderItemId);
    if (!item || item.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese producto en la cuenta.");
    }
    if (item.status !== "ordered") {
      throw new ConvexError("Cocina ya empezó a prepararlo; ya no se puede cambiar la cantidad.");
    }
    const order = await ctx.db.get("orders", item.orderId);
    const account = order ? await ctx.db.get("accounts", order.accountId) : null;
    if (!order || !account || account.state !== "open") {
      throw new ConvexError("Esta cuenta ya no admite cambios.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const qty = safeInteger(args.quantity, "Cantidad", 0);
    if (qty > 99) throw new ConvexError("La cantidad máxima es 99.");

    if (qty === 0) {
      const [mods, preps] = await Promise.all([
        ctx.db.query("orderItemModifiers").withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id)).take(30),
        ctx.db.query("orderItemPreparations").withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id)).take(10),
      ]);
      for (const m of mods) await ctx.db.delete("orderItemModifiers", m._id);
      for (const p of preps) await ctx.db.delete("orderItemPreparations", p._id);
      await ctx.db.delete("orderItems", item._id);
    } else {
      await ctx.db.patch("orderItems", item._id, { quantity: qty, updatedAt: Date.now() });
    }

    await recalculateAccountTotal(ctx, account._id);
    return null;
  },
});

export const deliverOrderItem = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    quantity: v.optional(v.number()),
  },
  returns: v.object({
    deliveredUnits: v.number(),
    tableStatus: v.union(tableStatus, v.null()),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const item = await ctx.db.get("orderItems", args.orderItemId);
    if (!item || item.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese platillo en la cuenta.");
    }
    const order = await ctx.db.get("orders", item.orderId);
    const account = order ? await ctx.db.get("accounts", order.accountId) : null;
    if (!order || !account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("Esta cuenta ya terminó.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const preps = await ctx.db
      .query("orderItemPreparations")
      .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
      .take(10);
    const progress = computeItemProgress(item, preps);
    if (progress.deliverableQuantity <= 0) {
      const anyStationReady = preps.some(
        (p) => getPrepReadyQuantity(p, item.quantity) > progress.deliveredQuantity,
      );
      if (anyStationReady) {
        throw new ConvexError(
          `${item.dishName} todavía espera a que termine otra estación para entregarse.`,
        );
      }
      throw new ConvexError(`${item.dishName} todavía no tiene platillos listos para entregar.`);
    }

    const requested =
      args.quantity !== undefined
        ? safeInteger(args.quantity, "Cantidad a entregar", 1)
        : progress.deliverableQuantity;
    const deliveredUnits = Math.min(requested, progress.deliverableQuantity);
    const nextDelivered = progress.deliveredQuantity + deliveredUnits;
    const now = Date.now();

    await ctx.db.patch("orderItems", item._id, {
      deliveredQuantity: nextDelivered,
      updatedAt: now,
    });
    for (const prep of preps) {
      await ctx.db.patch("orderItemPreparations", prep._id, {
        deliveredAt: now,
        deliveredByStaffId: staff._id,
        updatedAt: now,
      });
    }

    await syncOrderItemStatus(ctx, item._id, now);
    await syncOrderAndAccountTable(ctx, order._id, now);
    const nextStatus = await syncAccountTableStatus(ctx, account._id, now);
    return { deliveredUnits, tableStatus: nextStatus };
  },
});

export const deliverStationItems = mutation({
  args: {
    accountId: v.id("accounts"),
    stationId: v.id("preparationStations"),
  },
  returns: v.object({
    deliveredCount: v.number(),
    tableStatus: v.union(tableStatus, v.null()),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("Esta cuenta ya terminó.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }
    const station = await ctx.db.get("preparationStations", args.stationId);
    if (!station || station.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esa área de preparación.");
    }

    const now = Date.now();
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(50);

    let deliveredCount = 0;
    let sawWaitingShared = false;
    const touchedOrders = new Set<Id<"orders">>();

    for (const order of orders) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(100);
      for (const item of items) {
        if (item.status === "cancelled" || getDeliveredQuantity(item) >= item.quantity) continue;
        const preps = await ctx.db
          .query("orderItemPreparations")
          .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
          .take(10);
        const stationPrep = preps.find((p) => p.stationId === station._id);
        if (!stationPrep) continue;

        const progress = computeItemProgress(item, preps);
        // Shared-dish rule: only deliverable units where EVERY assigned station is ready.
        if (progress.deliverableQuantity <= 0) {
          if (getPrepReadyQuantity(stationPrep, item.quantity) > progress.deliveredQuantity) {
            sawWaitingShared = true;
          }
          continue;
        }

        const nextDelivered = progress.deliveredQuantity + progress.deliverableQuantity;
        await ctx.db.patch("orderItems", item._id, {
          deliveredQuantity: nextDelivered,
          updatedAt: now,
        });
        for (const prep of preps) {
          await ctx.db.patch("orderItemPreparations", prep._id, {
            deliveredAt: now,
            deliveredByStaffId: staff._id,
            updatedAt: now,
          });
        }
        await syncOrderItemStatus(ctx, item._id, now);
        touchedOrders.add(order._id);
        deliveredCount += 1;
      }
    }

    if (deliveredCount === 0) {
      if (sawWaitingShared) {
        throw new ConvexError(
          `Los platillos compartidos de ${station.name} aún esperan a otra área para entregarse.`,
        );
      }
      throw new ConvexError(`Todavía no hay productos listos para entregar en ${station.name}.`);
    }

    for (const orderId of touchedOrders) {
      await syncOrderAndAccountTable(ctx, orderId, now);
    }
    const nextStatus = await syncAccountTableStatus(ctx, account._id, now);
    return { deliveredCount, tableStatus: nextStatus };
  },
});

export const deliverReadyItems = mutation({
  args: { accountId: v.id("accounts") },
  returns: v.object({
    deliveredCount: v.number(),
    tableStatus: v.union(tableStatus, v.null()),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("Esta cuenta ya terminó.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const now = Date.now();
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(50);

    let deliveredCount = 0;
    const touchedOrders = new Set<Id<"orders">>();
    for (const order of orders) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(100);
      for (const item of items) {
        if (item.status === "cancelled" || getDeliveredQuantity(item) >= item.quantity) continue;
        const preps = await ctx.db
          .query("orderItemPreparations")
          .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
          .take(10);
        const progress = computeItemProgress(item, preps);
        if (progress.deliverableQuantity <= 0) continue;

        const nextDelivered = progress.deliveredQuantity + progress.deliverableQuantity;
        await ctx.db.patch("orderItems", item._id, {
          deliveredQuantity: nextDelivered,
          updatedAt: now,
        });
        for (const prep of preps) {
          await ctx.db.patch("orderItemPreparations", prep._id, {
            deliveredAt: now,
            deliveredByStaffId: staff._id,
            updatedAt: now,
          });
        }
        await syncOrderItemStatus(ctx, item._id, now);
        touchedOrders.add(order._id);
        deliveredCount += progress.deliverableQuantity;
      }
    }

    if (deliveredCount === 0) {
      throw new ConvexError("Todavía no hay productos listos para entregar en esta cuenta.");
    }

    for (const orderId of touchedOrders) {
      await syncOrderAndAccountTable(ctx, orderId, now);
    }
    const nextStatus = await syncAccountTableStatus(ctx, account._id, now);
    return { deliveredCount, tableStatus: nextStatus };
  },
});

export const markAccountDelivered = mutation({
  args: { accountId: v.id("accounts") },
  returns: v.object({ deliveredCount: v.number() }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("Esta cuenta ya terminó.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const now = Date.now();
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(50);

    let deliveredCount = 0;
    for (const order of orders) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(100);
      for (const item of items) {
        if (item.status === "cancelled" || getDeliveredQuantity(item) >= item.quantity) continue;
        const preps = await ctx.db
          .query("orderItemPreparations")
          .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
          .take(10);
        for (const prep of preps) {
          await ctx.db.patch("orderItemPreparations", prep._id, {
            status: "delivered",
            startedQuantity: item.quantity,
            readyQuantity: item.quantity,
            deliveredAt: now,
            deliveredByStaffId: staff._id,
            updatedAt: now,
          });
        }
        await ctx.db.patch("orderItems", item._id, {
          status: "delivered",
          deliveredQuantity: item.quantity,
          updatedAt: now,
        });
        deliveredCount += 1;
      }
      if (order.status !== "delivered") {
        await ctx.db.patch("orders", order._id, { status: "delivered", updatedAt: now });
      }
    }

    await syncAccountTableStatus(ctx, account._id, now);
    return { deliveredCount };
  },
});

export const cancelOrderItem = mutation({
  args: {
    orderItemId: v.id("orderItems"),
    reason: v.string(),
    inventoryAction: v.optional(v.union(v.literal("none"), v.literal("return"), v.literal("waste"))),
  },
  returns: v.object({
    inventoryAction: v.union(v.literal("none"), v.literal("return"), v.literal("waste")),
    notifiedKitchen: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const reason = requiredText(args.reason, "Motivo de cancelación", 160);
    const item = await ctx.db.get("orderItems", args.orderItemId);
    if (!item || item.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese platillo en la cuenta.");
    }
    if (item.status === "cancelled") {
      throw new ConvexError("Este platillo ya fue cancelado.");
    }
    const order = await ctx.db.get("orders", item.orderId);
    const account = order ? await ctx.db.get("accounts", order.accountId) : null;
    if (!order || !account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos la cuenta de este platillo.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("No puedes cancelar platillos en una cuenta cerrada.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const now = Date.now();
    const consumed = getInventoryConsumedQuantity(item);
    let finalAction: "none" | "return" | "waste" = "none";
    if (consumed > 0) {
      finalAction = args.inventoryAction === "waste" ? "waste" : "return";
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id))
        .take(50);
      await reconcileCancelledRecipe(
        ctx,
        staff,
        item.dishId,
        consumed,
        `cancel:${item._id}`,
        finalAction,
        reason,
        modifiers,
      );
    }

    await ctx.db.patch("orderItems", item._id, {
      status: "cancelled",
      cancelledAt: now,
      cancelledByStaffId: staff._id,
      cancelReason: reason,
      cancelInventoryAction: finalAction,
      updatedAt: now,
    });

    const preps = await ctx.db
      .query("orderItemPreparations")
      .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", item._id))
      .take(10);

    const notifiedRoles = new Set<Doc<"preparationStations">["role"]>();
    for (const prep of preps) {
      const wasStarted = getPrepStartedQuantity(prep, item.quantity) > 0;
      const station = await ctx.db.get("preparationStations", prep.stationId);
      await ctx.db.patch("orderItemPreparations", prep._id, {
        status: "cancelled",
        // If station already started preparing, keep unacknowledged so it shows NO PREPARAR!
        cancelAcknowledgedAt: wasStarted ? undefined : now,
        updatedAt: now,
      });
      if (wasStarted && station) {
        notifiedRoles.add(resolveStationRole(station));
      }
    }

    await recalculateAccountTotal(ctx, account._id);
    await syncOrderAndAccountTable(ctx, order._id, now);

    if (notifiedRoles.size > 0) {
      const table = account.diningTableId ? await ctx.db.get("diningTables", account.diningTableId) : null;
      const destLabel = table?.tableNumber ?? account.customerName ?? `Folio A-${String(account.folio).padStart(4, "0")}`;
      await emitNotification(ctx, {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        kind: "cancel",
        title: `No preparar: ${item.quantity} × ${item.dishName}`,
        body: `${destLabel} · Motivo: ${reason}`,
        targetRoles: [...notifiedRoles],
        accountId: account._id,
        href: "/cuenta/cocina",
        actionLabel: "Ver pedidos",
      });
    }

    return {
      inventoryAction: finalAction,
      notifiedKitchen: notifiedRoles.size > 0,
    };
  },
});

export const reassignAccountWaiter = mutation({
  args: {
    accountId: v.id("accounts"),
    targetStaffId: v.id("staff"),
    reason: v.optional(v.string()),
  },
  returns: v.object({ assignedStaffName: v.string() }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("No puedes reasignar una cuenta cerrada.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const target = await ctx.db.get("staff", args.targetStaffId);
    if (
      !target ||
      !target.isActive ||
      target.locationId !== staff.locationId ||
      !target.roles.includes("waiter")
    ) {
      throw new ConvexError("Selecciona un mesero activo de esta sucursal.");
    }

    const now = Date.now();
    await ctx.db.insert("accountAssignments", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      accountId: account._id,
      previousStaffId: account.assignedStaffId,
      assignedStaffId: target._id,
      changedByStaffId: staff._id,
      reason: args.reason?.trim().slice(0, 140) || undefined,
    });
    await ctx.db.patch("accounts", account._id, {
      assignedStaffId: target._id,
      updatedAt: now,
    });
    if (account.diningTableId) {
      const table = await ctx.db.get("diningTables", account.diningTableId);
      if (table && table.currentAccountId === account._id) {
        await ctx.db.patch("diningTables", table._id, { assignedStaffId: target._id });
      }
    }

    if (target._id !== staff._id) {
      const table = account.diningTableId ? await ctx.db.get("diningTables", account.diningTableId) : null;
      const label = table?.tableNumber ?? account.customerName ?? `Folio A-${String(account.folio).padStart(4, "0")}`;
      await emitNotification(ctx, {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        kind: "reassign",
        title: `Te asignaron ${label}`,
        body: `Cuenta A-${String(account.folio).padStart(4, "0")} transferida por ${staff.displayName}.`,
        targetStaffId: target._id,
        accountId: account._id,
        href: `/cuenta/mesero/cuenta/${account._id}`,
        actionLabel: "Abrir cuenta",
      });
    }

    return { assignedStaffName: target.displayName };
  },
});

export const confirmPayment = mutation({
  args: { accountId: v.id("accounts") },
  returns: v.object({
    folio: v.number(),
    totalCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("Esta cuenta ya está cerrada.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const items = await loadAccountItems(ctx, account._id);
    const activeItems = items.filter((i) => i.status !== "cancelled");
    if (activeItems.length === 0) {
      throw new ConvexError("Esta cuenta no tiene productos para cobrar. Puedes anularla desde Más acciones.");
    }

    const now = Date.now();
    await ctx.db.patch("accounts", account._id, {
      state: "closed",
      closedAt: now,
      updatedAt: now,
    });

    if (account.diningTableId) {
      const table = await ctx.db.get("diningTables", account.diningTableId);
      if (table && table.currentAccountId === account._id) {
        await ctx.db.patch("diningTables", table._id, {
          currentAccountId: undefined,
          assignedStaffId: undefined,
          status: "empty",
        });
      }
    }

    return { folio: account.folio, totalCents: account.totalCents };
  },
});

export const requestBill = mutation({
  args: { accountId: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state !== "open") {
      throw new ConvexError("Esta cuenta ya solicitó pago o está cerrada.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }
    const items = await loadAccountItems(ctx, account._id);
    const activeItems = items.filter((i) => i.status !== "cancelled");
    if (activeItems.length === 0) {
      throw new ConvexError("La cuenta todavía no tiene productos.");
    }
    const now = Date.now();
    await ctx.db.patch("accounts", account._id, {
      state: "awaiting_payment",
      billRequestedAt: now,
      updatedAt: now,
    });
    if (account.diningTableId) {
      await ctx.db.patch("diningTables", account.diningTableId, { status: "payment" });
    }
    const table = account.diningTableId ? await ctx.db.get("diningTables", account.diningTableId) : null;
    const label = table?.tableNumber ?? account.customerName ?? `Folio A-${String(account.folio).padStart(4, "0")}`;
    await emitNotification(ctx, {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      kind: "bill",
      title: `${label} quiere pagar`,
      body: `Folio A-${String(account.folio).padStart(4, "0")} · ${(account.totalCents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}`,
      targetRoles: ["owner", "manager", "cashier"],
      accountId: account._id,
      href: `/cuenta/mesero/cuenta/${account._id}`,
      actionLabel: "Abrir cuenta",
    });
    return null;
  },
});

export const reopenForOrdering = mutation({
  args: { accountId: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state !== "awaiting_payment") {
      throw new ConvexError("Solo se pueden reabrir cuentas que pidieron pago.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }
    const now = Date.now();
    await ctx.db.patch("accounts", account._id, {
      state: "open",
      billRequestedAt: undefined,
      updatedAt: now,
    });
    await syncAccountTableStatus(ctx, account._id, now);
    return null;
  },
});

export const voidEmptyAccount = mutation({
  args: { accountId: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state !== "open") {
      throw new ConvexError("Solo se pueden anular cuentas abiertas.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }
    const items = await loadAccountItems(ctx, account._id);
    const activeItems = items.filter((i) => i.status !== "cancelled");
    if (activeItems.length > 0) {
      throw new ConvexError("Esta cuenta ya tiene productos enviados.");
    }
    const now = Date.now();
    await ctx.db.patch("accounts", account._id, {
      state: "voided",
      closedAt: now,
      updatedAt: now,
    });
    if (account.diningTableId) {
      await ctx.db.patch("diningTables", account.diningTableId, {
        currentAccountId: undefined,
        status: "empty",
      });
    }
    return null;
  },
});

export const moveAccountToTable = mutation({
  args: {
    accountId: v.id("accounts"),
    targetTableId: v.id("diningTables"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId || account.kind !== "dine_in") {
      throw new ConvexError("No encontramos esta cuenta de mesa.");
    }
    if (account.state !== "open" && account.state !== "awaiting_payment") {
      throw new ConvexError("Solo se pueden mover cuentas activas.");
    }
    if (!isManagerOrOwner(staff) && account.assignedStaffId && account.assignedStaffId !== staff._id) {
      throw new ConvexError("Esta cuenta la atiende otro mesero.");
    }

    const target = await ctx.db.get("diningTables", args.targetTableId);
    if (!target || !target.isActive || target.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos la mesa de destino.");
    }
    if (target.currentAccountId) {
      const existing = await ctx.db.get("accounts", target.currentAccountId);
      if (existing && (existing.state === "open" || existing.state === "awaiting_payment")) {
        throw new ConvexError("La mesa de destino ya está ocupada.");
      }
    }

    if (account.diningTableId) {
      await ctx.db.patch("diningTables", account.diningTableId, {
        currentAccountId: undefined,
        status: "empty",
      });
    }
    const now = Date.now();
    await ctx.db.patch("accounts", account._id, {
      diningTableId: target._id,
      sectionId: target.sectionId,
      updatedAt: now,
    });
    await ctx.db.patch("diningTables", target._id, {
      currentAccountId: account._id,
      status: account.state === "awaiting_payment" ? "payment" : "occupied",
      assignedStaffId: account.assignedStaffId,
    });
    await syncAccountTableStatus(ctx, account._id, now);
    return null;
  },
});

export const createTakeoutAccount = mutation({
  args: {
    kind: v.union(v.literal("takeaway"), v.literal("pickup"), v.literal("counter")),
    customerName: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    promisedAt: v.optional(v.number()),
    phoneConsent: v.optional(v.boolean()),
  },
  returns: v.id("accounts"),
  handler: async (ctx, args) => {
    const staff = await serviceStaff(ctx);
    const customerName = args.customerName?.trim().slice(0, 80) || undefined;
    const customerPhone = args.customerPhone?.trim().slice(0, 24) || undefined;
    if (args.kind !== "counter") {
      if (!customerName) throw new ConvexError("Escribe el nombre del cliente para identificar el pedido.");
      if (customerPhone && !args.phoneConsent) {
        throw new ConvexError("Confirma el consentimiento del cliente para guardar su teléfono.");
      }
    }
    const now = Date.now();
    const folio = await allocateFolio(ctx, staff);
    return await ctx.db.insert("accounts", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      assignedStaffId: staff._id,
      openedByStaffId: staff._id,
      kind: args.kind,
      state: "open",
      folio,
      version: 1,
      requestId: `takeout:${staff._id}:${now}`,
      totalCents: 0,
      customerName,
      customerPhone,
      phoneConsentAt: customerPhone && args.phoneConsent ? now : undefined,
      privacyNoticeVersion: customerPhone && args.phoneConsent ? "v1" : undefined,
      promisedAt: args.promisedAt,
      updatedAt: now,
    });
  },
});
