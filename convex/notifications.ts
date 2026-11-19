import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaff } from "./model/access";
import { isNotificationForStaff } from "./model/notifications";
import { notificationKind } from "./model/validators";

const notificationView = v.object({
  _id: v.id("notifications"),
  kind: notificationKind,
  title: v.string(),
  body: v.string(),
  href: v.union(v.string(), v.null()),
  actionLabel: v.union(v.string(), v.null()),
  createdAt: v.number(),
  isRead: v.boolean(),
});

export const list = query({
  args: {},
  returns: v.object({
    unreadCount: v.number(),
    items: v.array(notificationView),
  }),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_locationId_and_createdAt", (q) => q.eq("locationId", staff.locationId))
      .order("desc")
      .take(120);

    const mine = recent
      .filter((n) => isNotificationForStaff(n, staff))
      .slice(0, 40)
      .map((n) => ({
        _id: n._id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href ?? null,
        actionLabel: n.actionLabel ?? null,
        createdAt: n.createdAt,
        isRead: n.readByStaffIds.includes(staff._id),
      }));

    return {
      unreadCount: mine.filter((n) => !n.isRead).length,
      items: mine,
    };
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const notification = await ctx.db.get("notifications", args.notificationId);
    if (!notification || notification.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos ese aviso.");
    }
    if (!isNotificationForStaff(notification, staff)) {
      throw new ConvexError("Este aviso no corresponde a tu cuenta.");
    }
    if (!notification.readByStaffIds.includes(staff._id)) {
      await ctx.db.patch("notifications", notification._id, {
        readByStaffIds: [...notification.readByStaffIds, staff._id],
      });
    }
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  returns: v.object({ updatedCount: v.number() }),
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_locationId_and_createdAt", (q) => q.eq("locationId", staff.locationId))
      .order("desc")
      .take(120);

    let updatedCount = 0;
    for (const notification of recent) {
      if (!isNotificationForStaff(notification, staff)) continue;
      if (notification.readByStaffIds.includes(staff._id)) continue;
      await ctx.db.patch("notifications", notification._id, {
        readByStaffIds: [...notification.readByStaffIds, staff._id],
      });
      updatedCount += 1;
    }
    return { updatedCount };
  },
});
