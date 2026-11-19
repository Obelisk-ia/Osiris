import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  PREPARATION_AREA_META,
  ROLE_TO_AREA,
  type PreparationArea,
} from "../../lib/restaurant-roles";

export function resolveStationArea(station: Doc<"preparationStations">): PreparationArea {
  if (station.area) return station.area;
  if (station.name === "Barra" && station.role === "bartender") return "bar";
  return ROLE_TO_AREA[station.role];
}

export function resolveStationRole(station: Doc<"preparationStations">): Doc<"preparationStations">["role"] {
  const area = resolveStationArea(station);
  return PREPARATION_AREA_META[area].role;
}

export function getDeliveredQuantity(
  item: Pick<Doc<"orderItems">, "quantity" | "status" | "deliveredQuantity">,
): number {
  if (item.deliveredQuantity !== undefined) {
    return Math.max(0, Math.min(item.quantity, item.deliveredQuantity));
  }
  return item.status === "delivered" ? item.quantity : 0;
}

export function getInventoryConsumedQuantity(
  item: Pick<Doc<"orderItems">, "quantity" | "inventoryConsumedAt" | "inventoryConsumedQuantity">,
): number {
  if (item.inventoryConsumedQuantity !== undefined) {
    return Math.max(0, Math.min(item.quantity, item.inventoryConsumedQuantity));
  }
  return item.inventoryConsumedAt !== undefined ? item.quantity : 0;
}

export function getPrepStartedQuantity(
  prep: Pick<Doc<"orderItemPreparations">, "status" | "startedQuantity">,
  itemQuantity: number,
): number {
  if (prep.startedQuantity !== undefined) {
    return Math.max(0, Math.min(itemQuantity, prep.startedQuantity));
  }
  return prep.status === "ordered" ? 0 : itemQuantity;
}

export function getPrepReadyQuantity(
  prep: Pick<Doc<"orderItemPreparations">, "status" | "startedQuantity" | "readyQuantity">,
  itemQuantity: number,
): number {
  const started = getPrepStartedQuantity(prep, itemQuantity);
  if (prep.readyQuantity !== undefined) {
    return Math.max(0, Math.min(started, prep.readyQuantity));
  }
  return prep.status === "ready" || prep.status === "delivered" ? itemQuantity : 0;
}

/**
 * Shared-dish + partial-quantity rule:
 * - A dish assigned to multiple stations has `effectiveReadyQuantity = min(readyQuantity)` across ALL its stations.
 * - `deliverableQuantity = effectiveReadyQuantity - deliveredQuantity`.
 * - An item is "ready" whenever `deliverableQuantity > 0`, "delivered" when `deliveredQuantity >= quantity`,
 *   "preparing" when at least 1 unit has started (or been delivered), else "ordered".
 */
export function computeItemProgress(
  item: Pick<Doc<"orderItems">, "quantity" | "status" | "deliveredQuantity">,
  preps: ReadonlyArray<Pick<Doc<"orderItemPreparations">, "status" | "startedQuantity" | "readyQuantity">>,
) {
  const quantity = item.quantity;
  if (item.status === "cancelled") {
    return {
      quantity,
      effectiveReadyQuantity: 0,
      deliveredQuantity: 0,
      deliverableQuantity: 0,
      anyStarted: false,
      status: "cancelled" as const,
    };
  }
  const deliveredQuantity = getDeliveredQuantity(item);
  if (preps.length === 0) {
    const readyQty = item.status === "ready" || item.status === "delivered" ? quantity : 0;
    const deliverableQuantity = Math.max(0, readyQty - deliveredQuantity);
    const status: Doc<"orderItems">["status"] =
      deliveredQuantity >= quantity
        ? "delivered"
        : deliverableQuantity > 0
          ? "ready"
          : item.status === "preparing" || deliveredQuantity > 0
            ? "preparing"
            : "ordered";
    return {
      quantity,
      effectiveReadyQuantity: readyQty,
      deliveredQuantity,
      deliverableQuantity,
      anyStarted: status !== "ordered",
      status,
    };
  }

  const readyCounts = preps.map((p) => getPrepReadyQuantity(p, quantity));
  const startedCounts = preps.map((p) => getPrepStartedQuantity(p, quantity));
  const effectiveReadyQuantity = Math.min(...readyCounts);
  const deliverableQuantity = Math.max(0, effectiveReadyQuantity - deliveredQuantity);
  const anyStarted = startedCounts.some((c) => c > 0) || deliveredQuantity > 0;

  let status: Doc<"orderItems">["status"];
  if (deliveredQuantity >= quantity) {
    status = "delivered";
  } else if (deliverableQuantity > 0) {
    status = "ready";
  } else if (anyStarted) {
    status = "preparing";
  } else {
    status = "ordered";
  }

  return {
    quantity,
    effectiveReadyQuantity,
    deliveredQuantity,
    deliverableQuantity,
    anyStarted,
    status,
  };
}

export function derivePrepStatus(
  prep: Pick<Doc<"orderItemPreparations">, "status" | "startedQuantity" | "readyQuantity">,
  itemQuantity: number,
  deliveredQuantity: number,
  itemStatus?: Doc<"orderItems">["status"],
): Doc<"orderItemPreparations">["status"] {
  if (itemStatus === "cancelled" || prep.status === "cancelled") return "cancelled";
  if (deliveredQuantity >= itemQuantity) return "delivered";
  const started = getPrepStartedQuantity(prep, itemQuantity);
  const ready = getPrepReadyQuantity(prep, itemQuantity);
  if (ready >= itemQuantity) return "ready";
  if (started > 0 || ready > 0 || deliveredQuantity > 0) return "preparing";
  return "ordered";
}

export function deriveOrderStatus(
  items: ReadonlyArray<Pick<Doc<"orderItems">, "status">>,
): Doc<"orders">["status"] {
  if (items.length === 0) return "ordered";
  const active = items.filter((i) => i.status !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.every((i) => i.status === "delivered")) return "delivered";
  if (active.some((i) => i.status === "ready")) return "ready";
  if (active.some((i) => i.status !== "ordered")) return "preparing";
  return "ordered";
}

export function deriveAccountTableStatus(
  accountState: Doc<"accounts">["state"],
  items: ReadonlyArray<Pick<Doc<"orderItems">, "quantity" | "status" | "deliveredQuantity">>,
): Doc<"diningTables">["status"] {
  if (accountState === "closed" || accountState === "voided") return "empty";
  if (accountState === "awaiting_payment") return "payment";
  const active = items.filter((i) => i.status !== "cancelled");
  if (active.some((i) => i.status === "ready")) return "attended";
  const hasAnyDelivered = active.some((i) => getDeliveredQuantity(i) > 0);
  const hasAnyUndelivered = active.some((i) => getDeliveredQuantity(i) < i.quantity);
  if (hasAnyDelivered && hasAnyUndelivered) return "partial";
  return "occupied";
}

export async function loadAccountOrderItemsLite(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
): Promise<Array<Doc<"orderItems">>> {
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .take(50);
  const allItems: Array<Doc<"orderItems">> = [];
  for (const order of orders) {
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);
    allItems.push(...items);
  }
  return allItems;
}

export async function syncOrderItemStatus(
  ctx: MutationCtx,
  orderItemId: Id<"orderItems">,
  now: number,
): Promise<Doc<"orderItems">["status"] | null> {
  const item = await ctx.db.get("orderItems", orderItemId);
  if (!item) return null;
  const preps = await ctx.db
    .query("orderItemPreparations")
    .withIndex("by_orderItemId_and_stationId", (q) => q.eq("orderItemId", orderItemId))
    .take(10);

  const progress = computeItemProgress(item, preps);
  for (const prep of preps) {
    const nextPrepStatus = derivePrepStatus(prep, item.quantity, progress.deliveredQuantity, item.status);
    if (nextPrepStatus !== prep.status) {
      await ctx.db.patch("orderItemPreparations", prep._id, {
        status: nextPrepStatus,
        updatedAt: now,
      });
    }
  }

  if (progress.status !== item.status) {
    await ctx.db.patch("orderItems", orderItemId, { status: progress.status, updatedAt: now });
  }
  return progress.status;
}

export async function syncOrderAndAccountTable(
  ctx: MutationCtx,
  orderId: Id<"orders">,
  now: number,
): Promise<void> {
  const order = await ctx.db.get("orders", orderId);
  if (!order) return;
  const orderItems = await ctx.db
    .query("orderItems")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .take(100);
  const nextOrderStatus = deriveOrderStatus(orderItems);
  if (nextOrderStatus !== order.status) {
    await ctx.db.patch("orders", orderId, { status: nextOrderStatus, updatedAt: now });
  }
  await syncAccountTableStatus(ctx, order.accountId, now);
}

export async function syncAccountTableStatus(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  now: number,
): Promise<Doc<"diningTables">["status"] | null> {
  const account = await ctx.db.get("accounts", accountId);
  if (!account) return null;
  const allItems = await loadAccountOrderItemsLite(ctx, accountId);
  const nextTableStatus = deriveAccountTableStatus(account.state, allItems);
  if (account.diningTableId) {
    const table = await ctx.db.get("diningTables", account.diningTableId);
    if (table && table.currentAccountId === account._id && table.status !== nextTableStatus) {
      await ctx.db.patch("diningTables", table._id, { status: nextTableStatus });
    }
  }
  await ctx.db.patch("accounts", account._id, { updatedAt: now });
  return nextTableStatus;
}
