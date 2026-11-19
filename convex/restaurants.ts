import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireStaff, requireUser, requiredText } from "./model/access";
import { operationalRole, serviceMode } from "./model/validators";
import schema from "./schema";

const limiter = new RateLimiter(components.rateLimiter, {
  restaurantJoin: { kind: "token bucket", rate: 5, period: MINUTE, capacity: 5 },
  restaurantJoinIp: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 20 },
});

function normalizeCode(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
function displayCode(code: string) {
  return `OSR-${code.slice(3, 7)}-${code.slice(7, 11)}-${code.slice(11, 15)}`;
}
async function newCode(ctx: MutationCtx) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 5; attempt++) {
    const random = crypto.getRandomValues(new Uint8Array(12));
    const code = `OSR${Array.from(random, (byte) => alphabet[byte & 31]).join("")}`;
    if (!(await ctx.db.query("organizationCodes").withIndex("by_code", (q) => q.eq("code", code)).unique())) {
      return code;
    }
  }
  throw new ConvexError("No pudimos generar un código. Vuelve a intentar.");
}

const onboarding = v.union(
  v.object({ kind: v.literal("owner"), displayName: v.string(), restaurantName: v.string(), serviceMode: v.optional(serviceMode) }),
  v.object({ kind: v.literal("staff"), displayName: v.string(), code: v.string(), roles: v.array(operationalRole) }),
);
const registrationResult = v.union(
  v.object({ success: v.literal(true), staffId: v.id("staff") }),
  v.object({ success: v.literal(false), message: v.string() }),
);

export const completeRegistration = mutation({
  args: { registration: onboarding },
  returns: registrationResult,
  handler: async (ctx, { registration }) => {
    const user = await requireUser(ctx);
    // Idempotent retries never add restaurants/memberships or change chosen roles.
    if (user.staffId) return { success: true as const, staffId: user.staffId };
    const displayName = requiredText(registration.displayName, "Tu nombre");

    if (registration.kind === "owner") {
      const name = requiredText(registration.restaurantName, "Nombre del restaurante");
      const code = await newCode(ctx);
      const organizationId = await ctx.db.insert("organizations", { name, currencyCode: "MXN" });
      const locationId = await ctx.db.insert("locations", {
        organizationId, name, timeZone: "America/Mexico_City",
        guestOrderMode: "confirmation", maxPendingGuestOrders: 10,
        restrictWaitersToAssignedTables: false, serviceMode: registration.serviceMode ?? "mixed",
      });
      await ctx.db.patch("organizations", organizationId, { firstLocationId: locationId });
      const staffId = await ctx.db.insert("staff", {
        organizationId, locationId, userId: user._id, displayName, roles: ["owner"], isActive: true,
      });
      await ctx.db.insert("organizationCodes", { organizationId, locationId, code, updatedAt: Date.now() });
      await ctx.db.insert("accountFolioCounters", { organizationId, locationId, nextFolio: 1, updatedAt: Date.now() });
      await ctx.db.patch("users", user._id, { staffId });
      return { success: true as const, staffId };
    }

    const roles = [...new Set(registration.roles)].sort();
    if (roles.length < 1 || registration.roles.length > 6) {
      return { success: false as const, message: "Elige al menos un rol; puedes combinar hasta seis." };
    }
    const { ip } = await ctx.meta.getRequestMetadata();
    if (ip === null) return { success: false as const, message: "No pudimos verificar la solicitud. Vuelve a intentar." };
    const perUser = await limiter.limit(ctx, "restaurantJoin", { key: user._id });
    if (!perUser.ok) return { success: false as const, message: "Demasiados intentos. Espera un minuto antes de probar otro código." };
    const perIp = await limiter.limit(ctx, "restaurantJoinIp", { key: ip });
    if (!perIp.ok) return { success: false as const, message: "Demasiados intentos desde esta conexión. Espera un minuto." };
    // Return failures, don't throw: attempts must commit instead of rolling back.
    const invalidCode = { success: false as const, message: "El código del restaurante no es válido. Confírmalo con tu dueño o gerente." };
    if (registration.code.length > 100) return invalidCode;
    const code = normalizeCode(registration.code);
    if (!/^OSR[A-HJ-NP-Z2-9]{12}$/.test(code)) return invalidCode;
    const invitation = await ctx.db.query("organizationCodes").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!invitation) return invalidCode;
    const location = await ctx.db.get("locations", invitation.locationId);
    if (!location || location.organizationId !== invitation.organizationId) {
      return { success: false as const, message: "Este código ya no está disponible. Pide un código nuevo." };
    }
    const staffId = await ctx.db.insert("staff", {
      organizationId: invitation.organizationId, locationId: location._id, userId: user._id,
      displayName, roles, isActive: true,
    });
    await ctx.db.patch("users", user._id, { staffId });
    return { success: true as const, staffId };
  },
});

export const current = query({
  args: {},
  returns: v.union(v.null(), v.object({
    staff: schema.doc("staff"), restaurant: schema.doc("organizations"), location: schema.doc("locations"),
  })),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.staffId) return null;
    const staff = await ctx.db.get("staff", user.staffId);
    if (!staff || staff.userId !== user._id) throw new ConvexError("No pudimos encontrar tu registro.");
    const restaurant = await ctx.db.get("organizations", staff.organizationId);
    const location = await ctx.db.get("locations", staff.locationId);
    if (!restaurant || !location || location.organizationId !== restaurant._id) {
      throw new ConvexError("No pudimos encontrar tu restaurante.");
    }
    return { staff, restaurant, location };
  },
});

export const ownerCode = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, undefined, undefined, ["owner"]);
    const record = await ctx.db.query("organizationCodes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId)).unique();
    return record ? displayCode(record.code) : null;
  },
});

export const rotateCode = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, undefined, undefined, ["owner"]);
    const record = await ctx.db.query("organizationCodes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId)).unique();
    if (!record) throw new ConvexError("No pudimos encontrar el código.");
    const code = await newCode(ctx);
    await ctx.db.patch("organizationCodes", record._id, { code, updatedAt: Date.now() });
    return displayCode(code);
  },
});
