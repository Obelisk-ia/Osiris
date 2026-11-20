import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireStaff } from "./model/access";
import { buffetBatchIngredients, consumeRecipe } from "./model/inventory";
import {
  resolveStationRole,
  syncOrderAndAccountTable,
  syncOrderItemStatus,
} from "./model/orders";

async function preparationStaff(ctx: MutationCtx, stationId: Id<"preparationStations">) {
  const station = await ctx.db.get("preparationStations", stationId);
  if (!station?.isActive) throw new ConvexError("La estación de preparación no está disponible.");
  const staff = await requireStaff(ctx, station.organizationId, station.locationId, [
    "owner",
    "manager",
    resolveStationRole(station),
  ]);
  return { staff, station };
}

// Internal until the operational screens support their full lifecycle.
// All checks still derive identity server-side; no caller-supplied staff IDs.
export const startOrderPreparation = internalMutation({
  args: { preparationId: v.id("orderItemPreparations") },
  returns: v.null(),
  handler: async (ctx, { preparationId }) => {
    const preparation = await ctx.db.get("orderItemPreparations", preparationId);
    if (!preparation) throw new ConvexError("No encontramos la preparación.");
    const { staff } = await preparationStaff(ctx, preparation.stationId);
    if (preparation.organizationId !== staff.organizationId || preparation.locationId !== staff.locationId) throw new ConvexError("Preparación fuera de tu restaurante.");
    const item = await ctx.db.get("orderItems", preparation.orderItemId);
    if (!item || item.organizationId !== staff.organizationId || item.locationId !== staff.locationId) throw new ConvexError("Pedido fuera de tu restaurante.");
    const order = await ctx.db.get("orders", item.orderId);
    const account = order ? await ctx.db.get("accounts", order.accountId) : null;
    if (!order || !account || order.organizationId !== staff.organizationId || order.locationId !== staff.locationId ||
        account.organizationId !== staff.organizationId || account.locationId !== staff.locationId) throw new ConvexError("Cuenta fuera de tu restaurante.");
    if (preparation.status !== "ordered") return null; // Retry does not consume again.
    if (account.state === "closed" || account.state === "voided" || item.status === "delivered" || order.status === "delivered") throw new ConvexError("La cuenta o el pedido ya terminó.");
    const now = Date.now();
    if (item.inventoryConsumedAt === undefined) {
      const modifiers = await ctx.db.query("orderItemModifiers")
        .withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id)).take(51);
      if (modifiers.length > 50) throw new ConvexError("El pedido supera el límite de modificadores.");
      await consumeRecipe(ctx, staff, item.dishId, item.quantity, `order-item:${item._id}`, modifiers);
      await ctx.db.patch("orderItems", item._id, {
        inventoryConsumedAt: now,
        inventoryConsumedQuantity: item.quantity,
      });
    }
    await ctx.db.patch("orderItemPreparations", preparationId, {
      status: "preparing",
      startedQuantity: item.quantity,
      readyQuantity: 0,
      startedAt: now,
      startedByStaffId: staff._id,
      updatedAt: now,
    });
    await syncOrderItemStatus(ctx, item._id, now);
    await syncOrderAndAccountTable(ctx, order._id, now);
    return null;
  },
});

export const startBuffetBatch = internalMutation({
  args: { batchId: v.id("buffetBatches") },
  returns: v.null(),
  handler: async (ctx, { batchId }) => {
    const batch = await ctx.db.get("buffetBatches", batchId);
    if (!batch) throw new ConvexError("No encontramos el lote de buffet.");
    const { staff } = await preparationStaff(ctx, batch.stationId);
    if (batch.organizationId !== staff.organizationId || batch.locationId !== staff.locationId) throw new ConvexError("Lote fuera de tu restaurante.");
    const menu = await ctx.db.get("buffetMenus", batch.buffetMenuId);
    if (!menu?.isActive || menu.organizationId !== staff.organizationId || menu.locationId !== staff.locationId) throw new ConvexError("El menú de buffet no está disponible.");
    const menuDish = await ctx.db.query("buffetMenuDishes")
      .withIndex("by_buffetMenuId_and_dishId", (q) => q.eq("buffetMenuId", menu._id).eq("dishId", batch.dishId)).unique();
    if (!menuDish || menuDish.organizationId !== staff.organizationId || menuDish.locationId !== staff.locationId) throw new ConvexError("El platillo no pertenece a este menú de buffet.");
    if (batch.status !== "ordered") return null;
    if (batch.inventoryConsumedAt !== undefined) throw new ConvexError("El inventario de este lote ya se consumió.");
    const now = Date.now();
    await ctx.db.patch("buffetBatches", batchId, {
      ...await buffetBatchIngredients(ctx, staff, batch, now),
      status: "preparing", updatedAt: now,
    });
    return null;
  },
});
