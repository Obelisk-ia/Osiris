import { ConvexError, v } from "convex/values";
import schema from "./schema";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import { buffetPrices, managerPermission, serviceMode, staffRole } from "./model/validators";
import { canTransferStaff } from "../lib/restaurant-roles";

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

/* ───────── Miembros del equipo (dueño gestiona; gerentes autorizados pueden transferir) ───────── */

async function clearStaffFloorAssignments(
  ctx: MutationCtx,
  staffId: Id<"staff">,
  locationId: Id<"locations">,
) {
  const [sections, tables] = await Promise.all([
    ctx.db
      .query("sections")
      .withIndex("by_locationId_and_sortOrder", (q) => q.eq("locationId", locationId))
      .take(50),
    ctx.db
      .query("diningTables")
      .withIndex("by_locationId_and_assignedStaffId", (q) =>
        q.eq("locationId", locationId).eq("assignedStaffId", staffId),
      )
      .take(200),
  ]);
  const now = Date.now();
  for (const section of sections) {
    const latest = await ctx.db
      .query("sectionAssignments")
      .withIndex("by_sectionId_and_startsAt", (q) => q.eq("sectionId", section._id))
      .order("desc")
      .take(1);
    if (latest[0] && latest[0].assignedStaffId === staffId && latest[0].endsAt === undefined) {
      await ctx.db.patch("sectionAssignments", latest[0]._id, { endsAt: now });
    }
  }
  for (const table of tables) {
    await ctx.db.patch("diningTables", table._id, { assignedStaffId: undefined });
  }
}

export const membersSnapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currentLocationId: v.id("locations"),
    currentStaffId: v.id("staff"),
    isOwner: v.boolean(),
    canTransferStaff: v.boolean(),
    branches: v.array(v.object({ _id: v.id("locations"), name: v.string() })),
    members: v.array(schema.doc("staff")),
  }),
  handler: async (ctx) => {
    const staff = await editor(ctx);
    const isOwner = staff.roles.includes("owner");
    const allowTransfer = canTransferStaff(staff);
    const [restaurant, location, active, inactive, orgBranches] = await Promise.all([
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
      allowTransfer
        ? ctx.db
            .query("locations")
            .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
            .take(50)
        : Promise.resolve([]),
    ]);
    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currentLocationId: staff.locationId,
      currentStaffId: staff._id,
      isOwner,
      canTransferStaff: allowTransfer,
      branches: orgBranches.map((branch) => ({ _id: branch._id, name: branch.name })),
      members: [...active, ...inactive],
    };
  },
});

export const updateMemberRoles = mutation({
  args: {
    memberId: v.id("staff"),
    roles: v.array(staffRole),
    managerPermissions: v.optional(v.array(managerPermission)),
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
    const nextPermissions = nextRoles.includes("manager")
      ? [...new Set(args.managerPermissions ?? [])].sort()
      : [];
    await ctx.db.patch("staff", member._id, {
      roles: nextRoles,
      managerPermissions: nextPermissions.length > 0 ? nextPermissions : undefined,
    });
    return null;
  },
});

export const transferMemberBranch = mutation({
  args: {
    memberId: v.id("staff"),
    targetLocationId: v.id("locations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await editor(ctx);
    const isOwner = actor.roles.includes("owner");
    if (!canTransferStaff(actor)) {
      throw new ConvexError("No tienes permiso para cambiar personal de sucursal.");
    }
    const [member, targetBranch] = await Promise.all([
      ctx.db.get("staff", args.memberId),
      ctx.db.get("locations", args.targetLocationId),
    ]);
    if (!member || member.organizationId !== actor.organizationId) {
      throw new ConvexError("No encontramos a esa persona en tu equipo.");
    }
    if (!targetBranch || targetBranch.organizationId !== actor.organizationId) {
      throw new ConvexError("No encontramos la sucursal de destino.");
    }
    if (member.roles.includes("owner")) {
      throw new ConvexError("El dueño puede cambiar de sucursal directamente desde el selector.");
    }
    if (!isOwner) {
      if (member._id === actor._id) {
        throw new ConvexError("No puedes cambiarte de sucursal a ti mismo. Pídeselo al dueño.");
      }
      if (member.locationId !== actor.locationId) {
        throw new ConvexError("Solo puedes transferir personal de tu propia sucursal.");
      }
    }
    if (member.locationId === targetBranch._id) {
      throw new ConvexError("Esta persona ya pertenece a esa sucursal.");
    }
    await clearStaffFloorAssignments(ctx, member._id, member.locationId);
    await ctx.db.patch("staff", member._id, { locationId: targetBranch._id });
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
      await clearStaffFloorAssignments(ctx, member._id, member.locationId);
    }
    return null;
  },
});

/* ───────── Sucursales (solo dueño) ───────── */

const ALLOWED_TIMEZONES = new Set([
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
  "America/Mazatlan",
  "America/Tijuana",
  "America/Hermosillo",
  "America/Chihuahua",
]);

const branchStatusView = v.object({
  locationId: v.id("locations"),
  activeStaffCount: v.number(),
  totalTables: v.number(),
  occupiedTables: v.number(),
  openAccounts: v.number(),
  awaitingPayment: v.number(),
  pendingTickets: v.number(),
  hasOpenShift: v.boolean(),
  lowStockCount: v.number(),
});

export const branchesSnapshot = query({
  args: {},
  returns: v.object({
    restaurantId: v.id("organizations"),
    restaurantName: v.string(),
    currencyCode: v.string(),
    currentLocationId: v.id("locations"),
    isOwner: v.boolean(),
    branches: v.array(schema.doc("locations")),
    branchStatuses: v.array(branchStatusView),
  }),
  handler: async (ctx) => {
    const staff = await ownerOnly(ctx);
    const [restaurant, branches, inventoryItems] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db
        .query("locations")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(50),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_organizationId_and_name", (q) => q.eq("organizationId", staff.organizationId))
        .take(250),
    ]);
    if (!restaurant) throw new ConvexError("No encontramos tu restaurante.");
    const trackedItems = inventoryItems.filter(
      (item) => item.isActive && (item.minMicros ?? 0) > 0,
    );

    const branchStatuses = await Promise.all(
      branches.map(async (branch) => {
        const [
          activeStaff,
          tables,
          openAccs,
          awaitingAccs,
          orderedPreps,
          preparingPreps,
          latestShift,
          balances,
        ] = await Promise.all([
          ctx.db
            .query("staff")
            .withIndex("by_locationId_and_isActive", (q) =>
              q.eq("locationId", branch._id).eq("isActive", true),
            )
            .take(100),
          ctx.db
            .query("diningTables")
            .withIndex("by_locationId_and_isActive", (q) =>
              q.eq("locationId", branch._id).eq("isActive", true),
            )
            .take(200),
          ctx.db
            .query("accounts")
            .withIndex("by_locationId_and_state", (q) =>
              q.eq("locationId", branch._id).eq("state", "open"),
            )
            .take(100),
          ctx.db
            .query("accounts")
            .withIndex("by_locationId_and_state", (q) =>
              q.eq("locationId", branch._id).eq("state", "awaiting_payment"),
            )
            .take(100),
          ctx.db
            .query("orderItemPreparations")
            .withIndex("by_locationId_and_status", (q) =>
              q.eq("locationId", branch._id).eq("status", "ordered"),
            )
            .take(100),
          ctx.db
            .query("orderItemPreparations")
            .withIndex("by_locationId_and_status", (q) =>
              q.eq("locationId", branch._id).eq("status", "preparing"),
            )
            .take(100),
          ctx.db
            .query("cashShifts")
            .withIndex("by_locationId_and_openedAt", (q) => q.eq("locationId", branch._id))
            .order("desc")
            .take(1),
          trackedItems.length > 0
            ? ctx.db
                .query("inventoryBalances")
                .withIndex("by_locationId_and_inventoryItemId", (q) =>
                  q.eq("locationId", branch._id),
                )
                .take(300)
            : Promise.resolve([]),
        ]);

        const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros]));
        let lowStockCount = 0;
        for (const item of trackedItems) {
          const qty = balanceMap.get(item._id) ?? 0;
          if (qty <= (item.minMicros ?? 0)) lowStockCount++;
        }

        return {
          locationId: branch._id,
          activeStaffCount: activeStaff.filter((member) => !member.roles.includes("owner")).length,
          totalTables: tables.length,
          occupiedTables: tables.filter((t) => t.status !== "empty").length,
          openAccounts: openAccs.length,
          awaitingPayment: awaitingAccs.length,
          pendingTickets: orderedPreps.length + preparingPreps.length,
          hasOpenShift: Boolean(latestShift[0] && latestShift[0].closedAt === undefined),
          lowStockCount,
        };
      }),
    );

    return {
      restaurantId: restaurant._id,
      restaurantName: restaurant.name,
      currencyCode: restaurant.currencyCode,
      currentLocationId: staff.locationId,
      isOwner: true,
      branches,
      branchStatuses,
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
    const staff = await ownerOnly(ctx);
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
    const staff = await ownerOnly(ctx);
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
    const staff = await ownerOnly(ctx);
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
    const staff = await ownerOnly(ctx);
    if (args.locationId === staff.locationId) {
      throw new ConvexError("No puedes quitar la sucursal en uso. Cambia primero a otra.");
    }
    const branch = await ctx.db.get("locations", args.locationId);
    if (!branch || branch.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos esa sucursal.");
    }
    const [activeStaff, openAccounts, orgCode, availabilityOverrides] = await Promise.all([
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
      ctx.db
        .query("organizationCodes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .unique(),
      ctx.db
        .query("locationDishAvailability")
        .withIndex("by_locationId", (q) => q.eq("locationId", branch._id))
        .take(500),
    ]);
    if (activeStaff.length > 0) {
      throw new ConvexError("Esta sucursal tiene personal activo asignado.");
    }
    if (openAccounts.length > 0) {
      throw new ConvexError("Esta sucursal tiene cuentas abiertas.");
    }
    if (orgCode && orgCode.locationId === branch._id) {
      await ctx.db.patch("organizationCodes", orgCode._id, { locationId: staff.locationId });
    }
    for (const override of availabilityOverrides) {
      await ctx.db.delete("locationDishAvailability", override._id);
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
