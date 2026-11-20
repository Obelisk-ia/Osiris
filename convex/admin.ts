import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import { buffetPrices, serviceMode, staffRole } from "./model/validators";

const EDITORS = ["owner", "manager"] as const;

async function editor(ctx: MutationCtx | QueryCtx) {
  return await requireStaff(ctx, undefined, undefined, EDITORS);
}

async function ownerOnly(ctx: MutationCtx | QueryCtx) {
  return await requireStaff(ctx, undefined, undefined, ["owner"]);
}

/* ───────── Características y operación de sucursal ───────── */

export const featuresSnapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    serviceMode,
    buffetTableService: v.boolean(),
    buffetPrices: v.union(buffetPrices, v.null()),
    guestOrderMode: v.union(v.literal("confirmation"), v.literal("direct")),
    maxPendingGuestOrders: v.number(),
    restrictWaitersToAssignedTables: v.boolean(),
    autoSoldOut: v.boolean(),
    autoLateOrderEnabled: v.boolean(),
    autoLateOrderMinutes: v.number(),
    autoAtypicalEnabled: v.boolean(),
    autoAtypicalThreshold: v.number(),
    autoSupplierOrder: v.boolean(),
    autoDailySummary: v.boolean(),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const [restaurant, location] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
    ]);
    if (!location) throw new ConvexError("No encontramos tu sucursal.");
    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location.name,
      currencyCode: restaurant?.currencyCode ?? "MXN",
      serviceMode: location.serviceMode,
      buffetTableService: location.buffetTableService ?? true,
      buffetPrices: location.buffetPrices ?? null,
      guestOrderMode: location.guestOrderMode,
      maxPendingGuestOrders: location.maxPendingGuestOrders,
      restrictWaitersToAssignedTables: location.restrictWaitersToAssignedTables,
      autoSoldOut: location.autoSoldOut ?? true,
      autoLateOrderEnabled: location.autoLateOrderEnabled ?? true,
      autoLateOrderMinutes: location.autoLateOrderMinutes ?? 20,
      autoAtypicalEnabled: location.autoAtypicalEnabled ?? true,
      autoAtypicalThreshold: location.autoAtypicalThreshold ?? 3,
      autoSupplierOrder: location.autoSupplierOrder ?? true,
      autoDailySummary: location.autoDailySummary ?? true,
    };
  },
});

export const updateFeatures = mutation({
  args: {
    serviceMode: v.optional(serviceMode),
    buffetTableService: v.optional(v.boolean()),
    buffetPrices: v.optional(buffetPrices),
    guestOrderMode: v.optional(v.union(v.literal("confirmation"), v.literal("direct"))),
    maxPendingGuestOrders: v.optional(v.number()),
    restrictWaitersToAssignedTables: v.optional(v.boolean()),
    autoSoldOut: v.optional(v.boolean()),
    autoLateOrderEnabled: v.optional(v.boolean()),
    autoLateOrderMinutes: v.optional(v.number()),
    autoAtypicalEnabled: v.optional(v.boolean()),
    autoAtypicalThreshold: v.optional(v.number()),
    autoSupplierOrder: v.optional(v.boolean()),
    autoDailySummary: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const location = await ctx.db.get("locations", staff.locationId);
    if (!location || location.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos tu sucursal.");
    }
    const patch: Record<string, unknown> = {};
    if (args.serviceMode !== undefined) patch.serviceMode = args.serviceMode;
    if (args.buffetTableService !== undefined) patch.buffetTableService = args.buffetTableService;
    if (args.buffetPrices) {
      const adultCents = safeInteger(args.buffetPrices.adultCents, "Tarifa de adulto", 1);
      const childCents = args.buffetPrices.childCents === null
        ? null : safeInteger(args.buffetPrices.childCents, "Tarifa de niño");
      if (adultCents > 1_000_000 || (childCents ?? 0) > 1_000_000) {
        throw new ConvexError("La tarifa por persona excede el límite permitido.");
      }
      patch.buffetPrices = { adultCents, childCents };
    }
    if (args.guestOrderMode !== undefined) patch.guestOrderMode = args.guestOrderMode;
    if (args.maxPendingGuestOrders !== undefined) {
      const limit = safeInteger(args.maxPendingGuestOrders, "Límite de pedidos QR", 1);
      if (limit > 50) throw new ConvexError("El límite máximo es de 50 pedidos pendientes.");
      patch.maxPendingGuestOrders = limit;
    }
    if (args.restrictWaitersToAssignedTables !== undefined) {
      patch.restrictWaitersToAssignedTables = args.restrictWaitersToAssignedTables;
    }
    if (args.autoSoldOut !== undefined) patch.autoSoldOut = args.autoSoldOut;
    if (args.autoLateOrderEnabled !== undefined) patch.autoLateOrderEnabled = args.autoLateOrderEnabled;
    if (args.autoLateOrderMinutes !== undefined) {
      const mins = safeInteger(args.autoLateOrderMinutes, "Minutos de demora", 1);
      if (mins > 240) throw new ConvexError("Escribe entre 1 y 240 minutos.");
      patch.autoLateOrderMinutes = mins;
    }
    if (args.autoAtypicalEnabled !== undefined) patch.autoAtypicalEnabled = args.autoAtypicalEnabled;
    if (args.autoAtypicalThreshold !== undefined) {
      const count = safeInteger(args.autoAtypicalThreshold, "Límite de acciones", 1);
      if (count > 50) throw new ConvexError("Escribe entre 1 y 50 acciones.");
      patch.autoAtypicalThreshold = count;
    }
    if (args.autoSupplierOrder !== undefined) patch.autoSupplierOrder = args.autoSupplierOrder;
    if (args.autoDailySummary !== undefined) patch.autoDailySummary = args.autoDailySummary;

    await ctx.db.patch("locations", location._id, patch);
    return null;
  },
});

/* ───────── Miembros del equipo (solo dueño gestiona) ───────── */

export const membersSnapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currentStaffId: v.id("staff"),
    isOwner: v.boolean(),
    members: v.array(schema.doc("staff")),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const [restaurant, location, active, inactive] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", true),
        )
        .take(100),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", false),
        )
        .take(100),
    ]);
    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currentStaffId: staff._id,
      isOwner: staff.roles.includes("owner"),
      members: [...active, ...inactive],
    };
  },
});

export const updateMemberRoles = mutation({
  args: {
    memberId: v.id("staff"),
    roles: v.array(staffRole),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await ownerOnly(ctx);
    const member = await ctx.db.get("staff", args.memberId);
    if (!member || member.organizationId !== owner.organizationId) {
      throw new ConvexError("No encontramos a esa persona en tu equipo.");
    }
    const nextRoles = [...new Set(args.roles)].sort();
    if (nextRoles.length < 1) {
      throw new ConvexError("Cada miembro necesita al menos un rol.");
    }
    if (member._id === owner._id && !nextRoles.includes("owner")) {
      throw new ConvexError("No puedes quitarte el rol de dueño a ti mismo.");
    }
    if (member._id !== owner._id && nextRoles.includes("owner")) {
      throw new ConvexError("Solo el titular puede tener el rol de dueño.");
    }
    await ctx.db.patch("staff", member._id, { roles: nextRoles });
    return null;
  },
});

export const toggleMemberActive = mutation({
  args: { memberId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await ownerOnly(ctx);
    const member = await ctx.db.get("staff", args.memberId);
    if (!member || member.organizationId !== owner.organizationId) {
      throw new ConvexError("No encontramos a esa persona en tu equipo.");
    }
    if (member._id === owner._id) {
      throw new ConvexError("No puedes desactivar tu propia cuenta.");
    }
    const nextActive = !member.isActive;
    await ctx.db.patch("staff", member._id, { isActive: nextActive });
    if (!nextActive) {
      // Clear any active section assignments for this waiter.
      const sections = await ctx.db
        .query("sections")
        .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", member.locationId))
        .take(50);
      for (const section of sections) {
        const latest = await ctx.db
          .query("sectionAssignments")
          .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", section._id))
          .order("desc")
          .take(1);
        if (latest[0] && latest[0].assignedStaffId === member._id && latest[0].endsAt === undefined) {
          await ctx.db.patch("sectionAssignments", latest[0]._id, { endsAt: Date.now() });
        }
      }
    }
    return null;
  },
});

/* ───────── Sucursales ───────── */

const ALLOWED_TIMEZONES = new Set([
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
  "America/Mazatlan",
  "America/Tijuana",
  "America/Hermosillo",
  "America/Chihuahua",
]);

export const branchesSnapshot = query({
  args: {},
  returns: v.object({
    restaurantId: v.id("organizations"),
    restaurantName: v.string(),
    currencyCode: v.string(),
    currentLocationId: v.id("locations"),
    isOwner: v.boolean(),
    branches: v.array(schema.doc("locations")),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const [restaurant, branches] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db
        .query("locations")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(50),
    ]);
    if (!restaurant) throw new ConvexError("No encontramos tu restaurante.");
    return {
      restaurantId: restaurant._id,
      restaurantName: restaurant.name,
      currencyCode: restaurant.currencyCode,
      currentLocationId: staff.locationId,
      isOwner: staff.roles.includes("owner"),
      branches,
    };
  },
});

export const createBranch = mutation({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    timeZone: v.string(),
  },
  returns: v.id("locations"),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const name = requiredText(args.name, "Nombre de la sucursal", 100);
    const timeZone = ALLOWED_TIMEZONES.has(args.timeZone) ? args.timeZone : "America/Mexico_City";
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
      .take(50);
    if (existing.length >= 20) {
      throw new ConvexError("Llegaste al límite de 20 sucursales.");
    }
    const locationId = await ctx.db.insert("locations", {
      organizationId: staff.organizationId,
      name,
      address: args.address?.trim().slice(0, 180) || undefined,
      timeZone,
      guestOrderMode: "confirmation",
      maxPendingGuestOrders: 10,
      restrictWaitersToAssignedTables: false,
      serviceMode: "mixed",
      autoSoldOut: true,
      autoLateOrderEnabled: true,
      autoLateOrderMinutes: 20,
      autoAtypicalEnabled: true,
      autoAtypicalThreshold: 3,
      autoSupplierOrder: true,
      autoDailySummary: true,
    });
    await ctx.db.insert("accountFolioCounters", {
      organizationId: staff.organizationId,
      locationId,
      nextFolio: 1,
      updatedAt: Date.now(),
    });
    return locationId;
  },
});

export const updateBranch = mutation({
  args: {
    locationId: v.id("locations"),
    name: v.string(),
    address: v.optional(v.string()),
    timeZone: v.string(),
    restaurantName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const branch = await ctx.db.get("locations", args.locationId);
    if (!branch || branch.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa sucursal.");
    }
    const name = requiredText(args.name, "Nombre de la sucursal", 100);
    const timeZone = ALLOWED_TIMEZONES.has(args.timeZone) ? args.timeZone : branch.timeZone;
    await ctx.db.patch("locations", branch._id, {
      name,
      address: args.address?.trim().slice(0, 180) || undefined,
      timeZone,
    });
    if (args.restaurantName !== undefined) {
      const restaurantName = requiredText(args.restaurantName, "Nombre del restaurante", 100);
      await ctx.db.patch("organizations", staff.organizationId, { name: restaurantName });
    }
    return null;
  },
});

export const switchBranch = mutation({
  args: { locationId: v.id("locations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    const branch = await ctx.db.get("locations", args.locationId);
    if (!branch || branch.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa sucursal.");
    }
    await ctx.db.patch("staff", staff._id, { locationId: branch._id });
    return null;
  },
});

export const removeBranch = mutation({
  args: { locationId: v.id("locations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await editor(ctx);
    if (args.locationId === staff.locationId) {
      throw new ConvexError("No puedes quitar la sucursal en uso. Cambia primero a otra.");
    }
    const branch = await ctx.db.get("locations", args.locationId);
    if (!branch || branch.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa sucursal.");
    }
    const [activeStaff, openAccounts] = await Promise.all([
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", branch._id).eq("isActive", true),
        )
        .take(1),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) =>
          q.eq("locationId", branch._id).eq("state", "open"),
        )
        .take(1),
    ]);
    if (activeStaff.length > 0) {
      throw new ConvexError("Esta sucursal tiene personal activo asignado.");
    }
    if (openAccounts.length > 0) {
      throw new ConvexError("Esta sucursal tiene cuentas abiertas.");
    }
    const counter = await ctx.db
      .query("accountFolioCounters")
      .withIndex("by_locationId", (q) => q.eq("locationId", branch._id))
      .unique();
    if (counter) await ctx.db.delete("accountFolioCounters", counter._id);
    await ctx.db.delete("locations", branch._id);
    return null;
  },
});
