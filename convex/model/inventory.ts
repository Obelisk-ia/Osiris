import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { safeInteger } from "./access";

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
    if (!balance || balance.organizationId !== staff.organizationId) throw new ConvexError(`No hay existencias de ${item.name}.`);
    safeInteger(balance.quantityMicros, "Existencias");
    if (balance.quantityMicros < quantity) throw new ConvexError(`Inventario insuficiente: ${item.name}.`);
    await ctx.db.patch("inventoryBalances", balance._id, { quantityMicros: balance.quantityMicros - quantity, updatedAt: Date.now() });
    await ctx.db.insert("inventoryMovements", {
      organizationId: staff.organizationId, locationId: staff.locationId, inventoryItemId,
      kind: "consumption", quantityDeltaMicros: -quantity, referenceId, dishId,
      recipePortions: portions, reason: "Inicio de preparación", createdByStaffId: staff._id,
    });
  }
}
