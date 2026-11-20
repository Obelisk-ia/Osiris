import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function loadLocationDishAvailability(
  ctx: QueryCtx,
  locationId: Id<"locations">,
): Promise<Map<Id<"dishes">, boolean>> {
  const rows = await ctx.db
    .query("locationDishAvailability")
    .withIndex("by_locationId", (q) => q.eq("locationId", locationId))
    .take(500);
  return new Map(rows.map((row) => [row.dishId, row.isAvailable]));
}

export function resolveDishAvailability(
  dish: Pick<Doc<"dishes">, "_id" | "isAvailable">,
  availabilityMap: ReadonlyMap<Id<"dishes">, boolean>,
): boolean {
  return availabilityMap.get(dish._id) ?? dish.isAvailable;
}

export async function setLocationDishAvailability(
  ctx: MutationCtx,
  params: {
    organizationId: Id<"organizations">;
    locationId: Id<"locations">;
    dishId: Id<"dishes">;
    isAvailable: boolean;
  },
) {
  const existing = await ctx.db
    .query("locationDishAvailability")
    .withIndex("by_locationId_and_dishId", (q) =>
      q.eq("locationId", params.locationId).eq("dishId", params.dishId),
    )
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch("locationDishAvailability", existing._id, {
      isAvailable: params.isAvailable,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("locationDishAvailability", {
      organizationId: params.organizationId,
      locationId: params.locationId,
      dishId: params.dishId,
      isAvailable: params.isAvailable,
      updatedAt: now,
    });
  }
}
