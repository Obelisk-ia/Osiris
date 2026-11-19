import { ConvexError, v } from "convex/values";
import { canAccessWorkspace, formatRoles, workspaces } from "../lib/restaurant-roles";
import { query } from "./_generated/server";
import { requireStaff } from "./model/access";
import { workspace } from "./model/validators";

export const snapshot = query({
  args: { workspace },
  returns: v.object({
    title: v.string(), restaurantName: v.string(), items: v.array(v.object({
      id: v.string(), title: v.string(), detail: v.string(),
    })),
  }),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    if (!canAccessWorkspace(staff.roles, args.workspace)) {
      throw new ConvexError("No tienes permiso para acceder a esta área del restaurante.");
    }
    const restaurant = await ctx.db.get("organizations", staff.organizationId);
    const location = await ctx.db.get("locations", staff.locationId);
    if (!restaurant || !location || location.organizationId !== restaurant._id) {
      throw new ConvexError("No pudimos encontrar tu restaurante.");
    }
    const items: Array<{ id: string; title: string; detail: string }> = [];
    if (args.workspace === "administracion") {
      const members = await ctx.db.query("staff")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId).eq("isActive", true)).take(50);
      for (const member of members) items.push({
        id: member._id, title: member.displayName, detail: formatRoles(member.roles).join(" · "),
      });
    } else if (args.workspace === "mesas") {
      const restricted = location.restrictWaitersToAssignedTables && !staff.roles.some((role) => role === "owner" || role === "manager");
      const tables = restricted
        ? await ctx.db.query("diningTables").withIndex("by_locationId_and_assignedStaffId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("assignedStaffId", staff._id).eq("isActive", true)).take(50)
        : await ctx.db.query("diningTables").withIndex("by_locationId_and_isActive", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", true)).take(50);
      const statuses = {
        empty: "Libre",
        occupied: "Ocupada",
        partial: "Entrega parcial",
        attended: "Pedido listo",
        payment: "Quieren pagar",
      };
      for (const table of tables) items.push({
        id: table._id, title: table.tableNumber, detail: statuses[table.status],
      });
    } else if (args.workspace === "cocina") {
      for (const status of ["ordered", "preparing"] as const) {
        const preparations = await ctx.db.query("orderItemPreparations")
          .withIndex("by_locationId_and_status", (q) => q.eq("locationId", staff.locationId).eq("status", status)).take(25);
        for (const preparation of preparations) {
          const station = await ctx.db.get("preparationStations", preparation.stationId);
          if (!station || station.organizationId !== staff.organizationId || station.locationId !== staff.locationId) continue;
          if (!staff.roles.some((role) => role === station.role || role === "owner" || role === "manager")) continue;
          const item = await ctx.db.get("orderItems", preparation.orderItemId);
          if (item?.organizationId === staff.organizationId && item.locationId === staff.locationId) items.push({
            id: preparation._id, title: `${item.quantity} × ${item.dishName}`,
            detail: `${station.name} · ${status === "ordered" ? "Por preparar" : "Preparando"}`,
          });
        }
      }
    } else if (args.workspace === "caja") {
      const accounts = await ctx.db.query("accounts")
        .withIndex("by_locationId_and_state", (q) => q.eq("locationId", staff.locationId).eq("state", "awaiting_payment")).take(50);
      for (const account of accounts) items.push({
        id: account._id, title: `Cuenta ${account.folio}`,
        detail: new Intl.NumberFormat("es-MX", { style: "currency", currency: restaurant.currencyCode }).format(account.totalCents / 100),
      });
    } else {
      const menus = await ctx.db.query("buffetMenus")
        .withIndex("by_locationId_and_isActive_and_menuDate", (q) =>
          q.eq("locationId", staff.locationId).eq("isActive", true)).order("desc").take(50);
      for (const menu of menus) items.push({
        id: menu._id, title: menu.name, detail: menu.menuDate,
      });
    }
    return { title: workspaces.find((entry) => entry.value === args.workspace)!.label, restaurantName: restaurant.name, items };
  },
});
