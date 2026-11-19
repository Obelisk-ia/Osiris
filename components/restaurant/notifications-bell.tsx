"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  Bell,
  Check,
  CheckCheck,
  Clock,
  Info,
  Receipt,
  UserCheck,
  Utensils,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AdminModal, EmptyState } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

const KIND_ICON = {
  ready: Check,
  order: Utensils,
  cancel: Ban,
  bill: Receipt,
  reassign: UserCheck,
  late: Clock,
  info: Info,
} as const;

export function useNotificationsState(canQuery: boolean) {
  const data = useQuery(api.notifications.list, canQuery ? {} : "skip");
  return {
    unreadCount: data?.unreadCount ?? 0,
    items: data?.items ?? [],
    loading: data === undefined,
  };
}

export function NotificationsBell({
  canQuery,
  open: controlledOpen,
  onOpenChange,
}: {
  canQuery: boolean;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const { unreadCount, items } = useNotificationsState(canQuery);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const router = useRouter();
  const [markingAll, setMarkingAll] = useState(false);

  async function handleGo(id: Id<"notifications">, href: string | null, isRead: boolean) {
    if (!isRead) {
      try {
        await markRead({ notificationId: id });
      } catch {
        // Ignore read-mark failure on navigation
      }
    }
    setOpen(false);
    if (href) router.push(href);
  }

  async function handleMarkAll() {
    setMarkingAll(true);
    try {
      await markAllRead({});
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="relative inline-flex size-9 items-center justify-center rounded-full border border-border bg-card/80 text-foreground hover:border-foreground"
        aria-label={unreadCount > 0 ? `Avisos, ${unreadCount} sin leer` : "Avisos"}
        onClick={() => setOpen(true)}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <AdminModal
          title={unreadCount > 0 ? `Avisos (${unreadCount} sin leer)` : "Avisos"}
          onClose={() => setOpen(false)}
          footer={
            unreadCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={markingAll}
                onClick={() => void handleMarkAll()}
              >
                <CheckCheck className="size-4" aria-hidden="true" />
                {markingAll ? "Marcando…" : "Marcar todo como leído"}
              </Button>
            ) : undefined
          }
        >
          {items.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-6" aria-hidden="true" />}
              title="Sin avisos todavía"
              description="Aquí aparecerán pedidos nuevos, platillos listos para entregar, cancelaciones y reasignaciones."
            />
          ) : (
            <ul className="grid gap-2">
              {items.map((item) => {
                const Icon = KIND_ICON[item.kind] ?? AlertTriangle;
                const isCancel = item.kind === "cancel";
                const isReady = item.kind === "ready";
                return (
                  <li
                    key={item._id}
                    className={`rounded-xl border p-3 grid gap-1.5 ${
                      item.isRead
                        ? "border-[#ddd2b6] bg-background/50 opacity-80"
                        : isCancel
                          ? "border-destructive/50 bg-destructive/5"
                          : isReady
                            ? "border-[#6e7448] bg-[#6e7448]/10"
                            : "border-foreground/30 bg-card"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ${
                          isCancel
                            ? "bg-destructive/15 text-destructive"
                            : isReady
                              ? "bg-[#6e7448]/20 text-[#3c4124]"
                              : "bg-foreground/10 text-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <strong className="text-sm font-bold leading-snug">{item.title}</strong>
                          {!item.isRead && <span className="az-badge accent">Nuevo</span>}
                        </div>
                        {item.body && (
                          <p className="text-xs text-[#2a2620] mt-0.5">{item.body}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                    </div>

                    {(item.href || !item.isRead) && (
                      <div className="flex flex-wrap items-center gap-2 pl-9 pt-0.5">
                        {item.href && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => void handleGo(item._id, item.href, item.isRead)}
                          >
                            {item.actionLabel ?? "Ver"}
                          </Button>
                        )}
                        {!item.isRead && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => void markRead({ notificationId: item._id })}
                          >
                            Marcar como leído
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </AdminModal>
      )}
    </>
  );
}
