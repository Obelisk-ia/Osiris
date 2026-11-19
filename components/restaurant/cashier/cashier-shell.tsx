"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ArrowLeft,
  Bell,
  ChevronsUpDown,
  Grid2x2,
  LogOut,
  ShoppingBag,
  User,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api } from "@/convex/_generated/api";
import { AdminModal } from "@/components/restaurant/admin/admin-ui";
import { NotificationsBell, useNotificationsState } from "@/components/restaurant/notifications-bell";
import { formatRoles, type StaffRole } from "@/lib/restaurant-roles";
import { formatShortDate, initials, toRoman } from "@/lib/format";

export function CashierShell({
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
  const pathname = usePathname();
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
  const cashierSnap = useQuery(api.cashier.snapshot, canQuery ? {} : "skip");
  const { unreadCount } = useNotificationsState(canQuery);

  const restaurantName = live?.restaurant.name ?? initialRestaurantName;
  const locationName = live?.location.name ?? initialLocationName;
  const staffName = live?.staff.displayName ?? initialStaffName;
  const roles = (live?.staff.roles ?? initialRoles) as readonly StaffRole[];
  const roleLabel = formatRoles(roles).join(" · ");

  const readyToPayCount = cashierSnap?.readyAccounts.length ?? 0;

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

  const isTakeout = pathname.startsWith("/cuenta/mesero/llevar");
  const isTables = pathname === "/cuenta/mesas" || pathname.startsWith("/cuenta/mesas/");
  const isOrderDetail =
    pathname.startsWith("/cuenta/mesero/mesa/") || pathname.startsWith("/cuenta/mesero/cuenta/");
  const isCaja = !isTakeout && !isTables;

  const hasKitchen = roles.some(
    (r) => r === "chef" || r === "bar" || r === "bartender" || r === "barista",
  );
  const hasWaiter = roles.includes("waiter");

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
  if (hasWaiter) extraWorkspaces.push({ href: "/cuenta/mesas", label: "Vista de mesero", icon: Grid2x2 });
  if (hasKitchen) {
    extraWorkspaces.push({ href: "/cuenta/cocina", label: "Cocina y estaciones", icon: UtensilsCrossed });
  }

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

  const navItems = [
    { id: "caja", label: "Caja", href: "/cuenta/caja", active: isCaja && !isOrderDetail, badge: readyToPayCount },
    { id: "mesas", label: "Mesas", href: "/cuenta/mesas", active: isTables, badge: 0 },
    { id: "llevar", label: "Para llevar", href: "/cuenta/mesero/llevar", active: isTakeout, badge: 0 },
  ];

  const pageTitle = isOrderDetail
    ? "Cuenta"
    : isTakeout
      ? "Para llevar"
      : isTables
        ? "Mesas"
        : "Caja";

  return (
    <div className="az-shell">
      <aside className="az-side" aria-label="Navegación de caja">
        <Link className="brand" href="/cuenta/caja">
          <span className="brand-mark" aria-hidden="true">Ø</span>
          <strong>Osiris</strong>
        </Link>

        <nav className="az-side-nav" aria-label="Pantallas de caja">
          {navItems.map((item, idx) => (
            <Link
              key={item.id}
              href={item.href}
              className="az-side-link"
              aria-current={item.active ? "page" : undefined}
            >
              <span className="az-nav-num" aria-hidden="true">
                {toRoman(idx + 1)}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && <span className="az-count">{item.badge}</span>}
            </Link>
          ))}
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
        {isOrderDetail && (
          <Link
            href="/cuenta/caja"
            className="inline-flex size-9 items-center justify-center rounded-full hover:bg-black/5"
            aria-label="Volver a caja"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        )}
        <div className="az-top-title">
          <strong>{pageTitle}</strong>
          <span>
            {restaurantName} · {locationName}
          </span>
        </div>
        <span className="az-top-date">{formatShortDate()}</span>
        <span className="az-status-pulse">
          <i aria-hidden="true" />
          Caja
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
        {/* Anubis is the cashier god in the Atelier Zero design */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="az-backdrop-img" src="/collage/anubis.webp" alt="" />
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
        <Link
          href="/cuenta/caja"
          className="az-nav-btn"
          aria-current={isCaja ? "page" : undefined}
        >
          <Wallet aria-hidden="true" />
          <span>{readyToPayCount > 0 ? `Caja (${readyToPayCount})` : "Caja"}</span>
        </Link>
        <Link
          href="/cuenta/mesas"
          className="az-nav-btn"
          aria-current={isTables ? "page" : undefined}
        >
          <Grid2x2 aria-hidden="true" />
          <span>Mesas</span>
        </Link>
        <Link
          href="/cuenta/mesero/llevar"
          className="az-nav-btn"
          aria-current={isTakeout ? "page" : undefined}
        >
          <ShoppingBag aria-hidden="true" />
          <span>Para llevar</span>
        </Link>
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
