"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Bell,
  ChefHat,
  ChevronsUpDown,
  Grid2x2,
  LogOut,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api } from "@/convex/_generated/api";
import { AdminModal } from "@/components/restaurant/admin/admin-ui";
import { NotificationsBell, useNotificationsState } from "@/components/restaurant/notifications-bell";
import {
  areasForStaffRoles,
  formatRoles,
  PREPARATION_AREA_META,
  type StaffRole,
} from "@/lib/restaurant-roles";
import { formatShortDate, initials, toRoman } from "@/lib/format";

export function KitchenShell({
  initialRestaurantName,
  initialLocationName,
  initialStaffName,
  initialRoles,
  children,
}: {
  initialRestaurantName: string;
  initialLocationName: string;
  initialStaffName: string;
  initialRoles: readonly StaffRole[];
  children: ReactNode;
}) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const authToken = useAuthToken();
  const { isAuthenticated, isLoading } = useConvexAuth();

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const [avisosOpen, setAvisosOpen] = useState(false);
  const [signingOutToken, setSigningOutToken] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  const signingOut =
    signingOutToken !== null && (authToken === null || authToken === signingOutToken);
  const canQuery = isAuthenticated && !signingOut;

  const live = useQuery(api.restaurants.current, canQuery ? {} : "skip");
  const kitchenSnap = useQuery(api.kitchen.snapshot, canQuery ? {} : "skip");
  const { unreadCount } = useNotificationsState(canQuery);

  const restaurantName = live?.restaurant.name ?? initialRestaurantName;
  const locationName = live?.location.name ?? initialLocationName;
  const staffName = live?.staff.displayName ?? initialStaffName;
  const roles = (live?.staff.roles ?? initialRoles) as readonly StaffRole[];
  const roleLabel = formatRoles(roles).join(" · ");
  const stationAreas = kitchenSnap?.allowedAreas.map(({ area }) => area) ?? areasForStaffRoles(roles);
  const stationTitle =
    stationAreas.length === 1
      ? PREPARATION_AREA_META[stationAreas[0]].name
      : "Pedidos por estación";

  const newTicketCount = (kitchenSnap?.tickets.filter((t) => t.hasPending).length ?? 0) +
    (kitchenSnap?.replenishments.filter((batch) => batch.status === "ordered").length ?? 0);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);

  const hasWaiter = roles.includes("waiter");
  const hasCashier = roles.includes("cashier");

  async function handleSignOut() {
    if (signingOut) return;
    setAccountError(null);
    flushSync(() => {
      setSigningOutToken(authToken ?? "pending");
      setAccountMenuOpen(false);
      setMobileAccountOpen(false);
    });
    try {
      await signOut();
      router.replace("/acceso");
      router.refresh();
    } catch {
      setSigningOutToken(null);
      setAccountError("No pudimos cerrar tu sesión. Vuelve a intentar.");
    }
  }

  const extraWorkspaces: Array<{ href: string; label: string; icon: typeof Wallet }> = [];
  if (hasWaiter) extraWorkspaces.push({ href: "/cuenta/mesas", label: "Mesas", icon: Grid2x2 });
  if (hasCashier) extraWorkspaces.push({ href: "/cuenta/caja", label: "Caja", icon: Wallet });

  const accountMenuBody = (
    <div className="grid gap-3">
      <div className="az-who-account-head">
        <strong className="text-sm font-bold leading-snug text-foreground">{staffName}</strong>
        <span className="text-xs text-muted-foreground">
          {restaurantName} · {locationName}
        </span>
        <div className="az-cluster mt-1">
          {formatRoles(roles).map((label) => (
            <span key={label} className="az-badge accent">
              {label}
            </span>
          ))}
        </div>
      </div>

      {extraWorkspaces.length > 0 && (
        <div className="grid gap-1 pb-2 border-b border-[#ddd2b6]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Otras áreas
          </span>
          {extraWorkspaces.map((ws) => {
            const Icon = ws.icon;
            return (
              <Link
                key={ws.href}
                href={ws.href}
                onClick={() => {
                  setAccountMenuOpen(false);
                  setMobileAccountOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-black/5"
              >
                <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>{ws.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {accountError && (
        <p className="text-xs text-destructive" role="alert">
          {accountError}
        </p>
      )}

      <button
        type="button"
        className="az-who-logout"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
      >
        <LogOut className="size-4" aria-hidden="true" />
        <span>{signingOut ? "Cerrando sesión…" : "Cerrar sesión"}</span>
      </button>
    </div>
  );

  return (
    <div className="az-shell">
      <aside className="az-side" aria-label="Navegación de preparación">
        <Link className="brand" href="/cuenta/cocina">
          <span className="brand-mark" aria-hidden="true">Ø</span>
          <strong>Osiris</strong>
        </Link>

        <nav className="az-side-nav" aria-label="Pantallas de estación">
          <Link href="/cuenta/cocina" className="az-side-link" aria-current="page">
            <span className="az-nav-num" aria-hidden="true">
              {toRoman(1)}
            </span>
            <span className="flex-1">Pedidos</span>
            {newTicketCount > 0 && <span className="az-count">{newTicketCount}</span>}
          </Link>
          {hasWaiter && (
            <Link href="/cuenta/mesas" className="az-side-link">
              <span className="az-nav-num" aria-hidden="true">
                {toRoman(2)}
              </span>
              <span className="flex-1">Mesas</span>
            </Link>
          )}
        </nav>

        <div className="az-who-wrap" ref={menuWrapRef}>
          {accountMenuOpen && (
            <div className="az-who-popover" role="region" aria-label="Tu cuenta">
              {accountMenuBody}
            </div>
          )}
          <button
            type="button"
            className="az-who"
            aria-expanded={accountMenuOpen}
            aria-haspopup="true"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <span className="az-avatar" aria-hidden="true">
              {initials(staffName)}
            </span>
            <span className="az-who-text">
              <strong>{staffName}</strong>
              <span>{roleLabel} · Mi cuenta</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <header className="az-top">
        <div className="az-top-title">
          <strong>{stationTitle}</strong>
          <span>
            {restaurantName} · {locationName}
          </span>
        </div>
        <span className="az-top-date">{formatShortDate()}</span>
        <span className="az-status-pulse">
          <i aria-hidden="true" />
          {roleLabel}
        </span>
        <NotificationsBell canQuery={canQuery} open={avisosOpen} onOpenChange={setAvisosOpen} />
        <button
          type="button"
          className="az-only-mobile inline-flex items-center justify-center rounded-full"
          aria-label={`Cuenta de ${staffName}`}
          onClick={() => setMobileAccountOpen(true)}
        >
          <span className="az-avatar !w-8 !h-8 !text-xs" aria-hidden="true">
            {initials(staffName)}
          </span>
        </button>
      </header>

      <div className="az-backdrop" aria-hidden="true">
        {/* Sekhmet is the kitchen god in the Atelier Zero design */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="az-backdrop-img" src="/collage/sekhmet.webp" alt="" />
      </div>

      <main className="az-main">
        {signingOut ? (
          <p role="status" className="text-sm text-muted-foreground">
            Cerrando sesión…
          </p>
        ) : !isLoading && !isAuthenticated ? (
          <p role="status" className="text-sm text-muted-foreground">
            Cargando tu panel…
          </p>
        ) : (
          children
        )}
      </main>

      <nav className="az-bottom-nav" aria-label="Navegación principal móvil">
        <Link href="/cuenta/cocina" className="az-nav-btn" aria-current="page">
          <ChefHat aria-hidden="true" />
          <span>Pedidos</span>
        </Link>
        {hasWaiter && (
          <Link href="/cuenta/mesas" className="az-nav-btn">
            <Grid2x2 aria-hidden="true" />
            <span>Mesas</span>
          </Link>
        )}
        <button
          type="button"
          className="az-nav-btn"
          onClick={() => setAvisosOpen(true)}
        >
          <Bell aria-hidden="true" />
          <span>{unreadCount > 0 ? `Avisos (${unreadCount})` : "Avisos"}</span>
        </button>
        <button
          type="button"
          className="az-nav-btn"
          onClick={() => setMobileAccountOpen(true)}
        >
          <User aria-hidden="true" />
          <span>Cuenta</span>
        </button>
      </nav>

      {mobileAccountOpen && (
        <AdminModal title="Mi cuenta" onClose={() => setMobileAccountOpen(false)}>
          {accountMenuBody}
        </AdminModal>
      )}
    </div>
  );
}
