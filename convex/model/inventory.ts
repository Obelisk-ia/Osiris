import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { safeInteger } from "./access";

export async function buffetBatchIngredients(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  batch: Doc<"buffetBatches">,
  now: number,
) {
  if (batch.inventoryConsumedAt !== undefined) return {};
  await consumeRecipe(ctx, staff, batch.dishId, batch.portions, `buffet-batch:${batch._id}`);
  return { inventoryConsumedAt: now, startedByStaffId: staff._id };
}

export async function consumeRecipe(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  dishId: Id<"dishes">,
  portions: number,
  referenceId: string,
  modifiers: Doc<"orderItemModifiers">[] = [],
) {
  safeInteger(portions, "Porciones", 1);
  const dish = await ctx.db.get("dishes", dishId);
  if (!dish || dish.organizationId !== staff.organizationId) throw new ConvexError("El platillo no pertenece a este restaurante.");
  const recipe = await ctx.db.query("recipeIngredients")
    .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dishId)).take(101);
  if (recipe.length > 100) throw new ConvexError("La receta supera el límite de 100 ingredientes.");
  const quantities = new Map<Id<"inventoryItems">, number>();
  function add(itemId: Id<"inventoryItems">, micros: number) {
    if (!Number.isSafeInteger(micros)) throw new ConvexError("La receta contiene una cantidad inválida.");
    const total = (quantities.get(itemId) ?? 0) + micros;
    if (!Number.isSafeInteger(total)) throw new ConvexError("La cantidad excede el límite permitido.");
    quantities.set(itemId, total);
  }
  for (const ingredient of recipe) {
    if (ingredient.organizationId !== staff.organizationId) throw new ConvexError("La receta no pertenece a este restaurante.");
    safeInteger(ingredient.quantityMicros, "Ingrediente", 1);
    add(ingredient.inventoryItemId, ingredient.quantityMicros * portions);
  }
  for (const modifier of modifiers) {
    if (modifier.organizationId !== staff.organizationId || modifier.locationId !== staff.locationId ||
        modifier.dishId !== dishId || modifier.recipeDeltas.length > 100) {
      throw new ConvexError("El modificador no pertenece a este pedido.");
    }
    safeInteger(modifier.quantity, "Cantidad del modificador", 1);
    for (const delta of modifier.recipeDeltas) {
      if (!Number.isSafeInteger(delta.quantityDeltaMicros)) {
        throw new ConvexError("El modificador contiene una cantidad inválida.");
      }
      add(delta.inventoryItemId, delta.quantityDeltaMicros * modifier.quantity * portions);
    }
  }
  for (const [inventoryItemId, quantity] of quantities) {
    safeInteger(quantity, "Consumo");
    if (quantity === 0) continue;
    const item = await ctx.db.get("inventoryItems", inventoryItemId);
    if (!item?.isActive || item.organizationId !== staff.organizationId) throw new ConvexError("El ingrediente no está disponible.");
    const balance = await ctx.db.query("inventoryBalances")
      .withIndex("by_locationId_and_inventoryItemId", (q) =>
        q.eq("locationId", staff.locationId).eq("inventoryItemId", inventoryItemId)).unique();
    const now = Date.now();
    if (balance) {
      if (balance.organizationId !== staff.organizationId) {
        throw new ConvexError(`Existencias fuera de tu restaurante: ${item.name}.`);
      }
      if (!Number.isSafeInteger(balance.quantityMicros)) {
        throw new ConvexError("Las existencias contienen una cantidad inválida.");
      }
      const nextQuantity = balance.quantityMicros - quantity;
      if (!Number.isSafeInteger(nextQuantity)) {
        throw new ConvexError("La cantidad excede el límite permitido.");
      }
      await ctx.db.patch("inventoryBalances", balance._id, {
        quantityMicros: nextQuantity,
        updatedAt: now,
      });
    } else {
      const nextQuantity = -quantity;
      if (!Number.isSafeInteger(nextQuantity)) {
        throw new ConvexError("La cantidad excede el límite permitido.");
      }
      await ctx.db.insert("inventoryBalances", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        inventoryItemId,
        quantityMicros: nextQuantity,
        updatedAt: now,
      });
    }
    await ctx.db.insert("inventoryMovements", {
      organizationId: staff.organizationId, locationId: staff.locationId, inventoryItemId,
      kind: "consumption", quantityDeltaMicros: -quantity, referenceId, dishId,
      recipePortions: portions, reason: "Inicio de preparación", createdByStaffId: staff._id,
    });
  }
}

/**
 * Handles inventory reconciliation when an already-started order item is cancelled.
 * - `action === "return"`: restores the consumed recipe quantities back to stock.
 * - `action === "waste"`: logs a zero-delta waste movement noting the loss
 *   (stock was already deducted when preparation started).
 */
export async function reconcileCancelledRecipe(
  ctx: MutationCtx,
  staff: Doc<"staff">,
  dishId: Id<"dishes">,
  portions: number,
  referenceId: string,
  action: "return" | "waste",
  reasonText: string,
  modifiers: Doc<"orderItemModifiers">[] = [],
) {
  if (portions <= 0) return;
  safeInteger(portions, "Porciones", 1);
  const dish = await ctx.db.get("dishes", dishId);
  if (!dish || dish.organizationId !== staff.organizationId) return;

  const recipe = await ctx.db
    .query("recipeIngredients")
    .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dishId))
    .take(101);
  const quantities = new Map<Id<"inventoryItems">, number>();
  function add(itemId: Id<"inventoryItems">, micros: number) {
    if (!Number.isSafeInteger(micros)) return;
    const total = (quantities.get(itemId) ?? 0) + micros;
    if (!Number.isSafeInteger(total)) return;
    quantities.set(itemId, total);
  }
  for (const ingredient of recipe) {
    if (ingredient.organizationId !== staff.organizationId) continue;
    add(ingredient.inventoryItemId, ingredient.quantityMicros * portions);
  }
  for (const modifier of modifiers) {
    if (modifier.organizationId !== staff.organizationId || modifier.locationId !== staff.locationId) continue;
    for (const delta of modifier.recipeDeltas) {
      add(delta.inventoryItemId, delta.quantityDeltaMicros * modifier.quantity * portions);
    }
  }

  const now = Date.now();
  for (const [inventoryItemId, quantity] of quantities) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
    const item = await ctx.db.get("inventoryItems", inventoryItemId);
    if (!item || item.organizationId !== staff.organizationId) continue;

    if (action === "return") {
      const balance = await ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) =>
          q.eq("locationId", staff.locationId).eq("inventoryItemId", inventoryItemId),
        )
        .unique();
      if (balance && balance.organizationId === staff.organizationId) {
        await ctx.db.patch("inventoryBalances", balance._id, {
          quantityMicros: balance.quantityMicros + quantity,
          updatedAt: now,
        });
      } else if (!balance) {
        await ctx.db.insert("inventoryBalances", {
          organizationId: staff.organizationId,
          locationId: staff.locationId,
          inventoryItemId,
          quantityMicros: quantity,
          updatedAt: now,
        });
      }
      await ctx.db.insert("inventoryMovements", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        inventoryItemId,
        kind: "adjustment",
        quantityDeltaMicros: quantity,
        referenceId,
        dishId,
        recipePortions: portions,
        reason: `Cancelación (regresa a stock): ${reasonText}`.slice(0, 160),
        createdByStaffId: staff._id,
      });
    } else {
      await ctx.db.insert("inventoryMovements", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        inventoryItemId,
        kind: "waste",
        quantityDeltaMicros: 0,
        referenceId,
        dishId,
        recipePortions: portions,
        reason: `Pérdida por cancelación (ya descontado): ${reasonText}`.slice(0, 160),
        createdByStaffId: staff._id,
      });
    }
  }
}
