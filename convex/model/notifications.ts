import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function emitNotification(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    locationId: Id<"locations">;
    kind: Doc<"notifications">["kind"];
    title: string;
    body: string;
    targetStaffId?: Id<"staff">;
    targetRoles?: Array<Doc<"staff">["roles"][number]>;
    accountId?: Id<"accounts">;
    href?: string;
    actionLabel?: string;
  },
) {
  await ctx.db.insert("notifications", {
    organizationId: args.organizationId,
    locationId: args.locationId,
    kind: args.kind,
    title: args.title.slice(0, 140),
    body: args.body.slice(0, 280),
    targetStaffId: args.targetStaffId,
    targetRoles: args.targetRoles ? [...new Set(args.targetRoles)] : [],
    accountId: args.accountId,
    href: args.href,
    actionLabel: args.actionLabel,
    readByStaffIds: [],
    createdAt: Date.now(),
  });
}

export function isNotificationForStaff(
  notification: Pick<Doc<"notifications">, "targetStaffId" | "targetRoles">,
  staff: Pick<Doc<"staff">, "_id" | "roles">,
): boolean {
  if (notification.targetStaffId) {
    return notification.targetStaffId === staff._id;
  }
  return notification.targetRoles.some((role) => staff.roles.includes(role));
}
