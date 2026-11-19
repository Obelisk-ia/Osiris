import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  const user = userId === null ? null : await ctx.db.get("users", userId);
  if (user === null) throw new ConvexError("Inicia sesión para continuar.");
  return user;
}

export async function requireStaff(
  ctx: QueryCtx,
  organizationId?: Id<"organizations">,
  locationId?: Id<"locations">,
  allowedRoles?: ReadonlyArray<Doc<"staff">["roles"][number]>,
) {
  const user = await requireUser(ctx);
  const staff = user.staffId ? await ctx.db.get("staff", user.staffId) : null;
  if (!staff?.isActive || staff.userId !== user._id ||
      (organizationId && staff.organizationId !== organizationId) ||
      (locationId && staff.locationId !== locationId) ||
      (allowedRoles && !staff.roles.some((role) => allowedRoles.includes(role)))) {
    throw new ConvexError("No tienes permiso para acceder a esta área del restaurante.");
  }
  return staff;
}

export function requiredText(value: string, field: string, max = 100) {
  const text = value.trim();
  if (text.length < 1 || text.length > max) {
    throw new ConvexError(`${field}: escribe entre 1 y ${max} caracteres.`);
  }
  return text;
}

export function safeInteger(value: number, field: string, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new ConvexError(`${field} no es una cantidad válida.`);
  }
  return value;
}
