"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  BookOpen,
  Building2,
  Check,
  ChefHat,
  ChevronsUpDown,
  Copy,
  Grid2x2,
  KeyRound,
  LogOut,
  Menu,
  Package,
  QrCode,
  RefreshCw,
  Sliders,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatRoles, type ServiceMode, type StaffRole } from "@/lib/restaurant-roles";
import { errorMessage, formatShortDate, initials, toRoman } from "@/lib/format";
import { NotificationsBell } from "@/components/restaurant/notifications-bell";
import { AssistantDrawer } from "@/components/restaurant/assistant/assistant-drawer";
import { AdminModal, ConfirmModal } from "./admin-ui";

export type AdminNavItem = {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { id: "mesas", label: "Mesas", href: "/cuenta/mesas", icon: Grid2x2 },
  { id: "cocina", label: "Cocina", href: "/cuenta/cocina", icon: ChefHat },
  { id: "caja", label: "Caja", href: "/cuenta/caja", icon: Wallet },
  { id: "inventario", label: "Inventario", href: "/cuenta/administracion/inventario", icon: Package },
  { id: "menu", label: "Menú", href: "/cuenta/administracion/menu", icon: BookOpen },
  { id: "buffet", label: "Buffet", href: "/cuenta/administracion/buffet", icon: UtensilsCrossed },
  { id: "codigos-qr", label: "Códigos QR", href: "/cuenta/administracion/codigos-qr", icon: QrCode },
  { id: "caracteristicas", label: "Características", href: "/cuenta/administracion/caracteristicas", icon: Sliders },
  { id: "miembros", label: "Miembros", href: "/cuenta/administracion/miembros", icon: Users },
  { id: "sucursales", label: "Sucursales", href: "/cuenta/administracion/sucursales", icon: Building2 },
];

const MOBILE_PRIMARY_IDS = new Set(["mesas", "inventario", "menu", "buffet"]);

export function AdminShell({
  initialRestaurantName,
  initialLocationName,
  initialStaffName,
  initialRoles,
  initialServiceMode,
  children,
}: {
  initialRestaurantName: string;
  initialLocationName: string;
  initialStaffName: string;
  initialRoles: readonly StaffRole[];
  initialServiceMode: ServiceMode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const authToken = useAuthToken();
  const { isAuthenticated, isLoading } = useConvexAuth();

  const [moreOpen, setMoreOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signingOutToken, setSigningOutToken] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Scoped to the token being signed out so a freshly signed-in session never
  // inherits a stale signing-out state from a preserved client layout.
  const signingOut =
    signingOutToken !== null && (authToken === null || authToken === signingOutToken);

  const canQuery = isAuthenticated && !signingOut;
  const live = useQuery(api.restaurants.current, canQuery ? {} : "skip");
  const serviceMode = live?.location.serviceMode ?? initialServiceMode;
  const hasOpenReplenishments = useQuery(api.buffet.hasOpenReplenishments,
    canQuery && serviceMode === "a_la_carte" ? {} : "skip");
  const homeHref = serviceMode === "buffet" ? "/cuenta/buffet" : "/cuenta/mesas";
  const restaurantName = live?.restaurant.name ?? initialRestaurantName;
  const locationName = live?.location.name ?? initialLocationName;
  const staffName = live?.staff.displayName ?? initialStaffName;
  const roles = (live?.staff.roles ?? initialRoles) as readonly StaffRole[];
  const isOwner = roles.includes("owner");
  const roleLabel = formatRoles(roles).join(" · ");

  const ownerCode = useQuery(api.restaurants.ownerCode, canQuery && isOwner ? {} : "skip");
  const ownerBranches = useQuery(api.admin.branchesSnapshot, canQuery && isOwner ? {} : "skip");
  const cashierSnap = useQuery(api.cashier.snapshot, canQuery ? {} : "skip");
  const readyToPayCount = cashierSnap?.readyAccounts.length ?? 0;
  const rotateCode = useMutation(api.restaurants.rotateCode);
  const switchBranch = useMutation(api.admin.switchBranch);
  const [switchingBranch, setSwitchingBranch] = useState(false);

  const menuWrapRef = useRef<HTMLDivElement>(null);

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

  const visibleBaseItems = isOwner
    ? ADMIN_NAV_ITEMS
    : ADMIN_NAV_ITEMS.filter((item) => item.id !== "sucursales");
  const navItems = serviceMode !== "a_la_carte" ? visibleBaseItems : visibleBaseItems.flatMap((item) => {
    if (item.id !== "buffet") return [item];
    return hasOpenReplenishments ? [{ ...item, href: "/cuenta/buffet" }] : [];
  });
  const activeItem = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`) ||
    (item.id === "buffet" && pathname === "/cuenta/buffet")) ?? navItems[0];

  const primaryItems = navItems.filter((item) => MOBILE_PRIMARY_IDS.has(item.id));
  const secondaryItems = navItems.filter((item) => !MOBILE_PRIMARY_IDS.has(item.id));
  const inMore = secondaryItems.some((item) => item.id === activeItem.id);
  const collageSrc = isOwner ? "/collage/osiris.webp" : "/collage/thot.webp";

  async function handleSwitchBranch(nextLocationId: Id<"locations">) {
    if (switchingBranch || !ownerBranches || nextLocationId === ownerBranches.currentLocationId) return;
    setSwitchingBranch(true);
    setAccountError(null);
    try {
      const target = ownerBranches.branches.find((b) => b._id === nextLocationId);
      await switchBranch({ locationId: nextLocationId });
      if (pathname === "/cuenta/buffet" && target?.serviceMode === "a_la_carte") {
        router.replace("/cuenta/mesas");
      }
      router.refresh();
    } catch (cause) {
      setAccountError(errorMessage(cause, "No pudimos cambiar de sucursal."));
    } finally {
      setSwitchingBranch(false);
    }
  }

  async function handleCopyCode() {
    if (!ownerCode) return;
    setAccountError(null);
    try {
      await navigator.clipboard.writeText(ownerCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setAccountError("No pudimos copiarlo. Selecciona el código manualmente.");
    }
  }

  async function handleRotateCode() {
    setRotating(true);
    setAccountError(null);
    try {
      await rotateCode();
      setConfirmRotate(false);
    } catch (cause) {
      setAccountError(errorMessage(cause, "No pudimos actualizar el código."));
    } finally {
      setRotating(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setAccountError(null);
    // Unsubscribe all authenticated queries before signOut clears the token.
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

      {isOwner && ownerBranches && ownerBranches.branches.length > 1 && (
        <div className="az-who-code-block">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Building2 className="size-3.5" aria-hidden="true" />
            <span>Sucursal activa</span>
          </div>
          <select
            aria-label="Cambiar sucursal activa"
            className="az-select text-sm"
            value={ownerBranches.currentLocationId}
            disabled={switchingBranch}
            onChange={(event) => void handleSwitchBranch(event.target.value as Id<"locations">)}
          >
            {ownerBranches.branches.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isOwner && (
        <div className="az-who-code-block">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <KeyRound className="size-3.5" aria-hidden="true" />
            <span>Código del restaurante</span>
          </div>
          <code className="restaurant-code az-who-code">{ownerCode ?? "Cargando…"}</code>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!ownerCode}
              onClick={() => void handleCopyCode()}
            >
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={rotating}
              onClick={() => setConfirmRotate(true)}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Cambiar
            </Button>
          </div>
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
      <aside className="az-side" aria-label="Navegación de administración">
        <Link className="brand" href={homeHref}>
          <span className="brand-mark" aria-hidden="true">Ø</span>
          <strong>Osiris</strong>
        </Link>
        <nav className="az-side-nav" aria-label="Pantallas de administración">
          {navItems.map((item, idx) => {
            const current = item.id === activeItem.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                className="az-side-link"
                aria-current={current ? "page" : undefined}
              >
                <span className="az-nav-num" aria-hidden="true">
                  {toRoman(idx + 1)}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.id === "caja" && readyToPayCount > 0 && (
                  <span className="az-count">{readyToPayCount}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="az-who-wrap" ref={menuWrapRef}>
          {accountMenuOpen && (
            <div className="az-who-popover" role="region" aria-label="Cuenta y código del restaurante">
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
          <strong>{activeItem.label}</strong>
          <span>
            {restaurantName} · {locationName}
          </span>
        </div>
        {isOwner && ownerBranches && ownerBranches.branches.length > 1 && (
          <label className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
            <select
              aria-label="Cambiar de sucursal"
              className="az-select h-8 py-0 px-2 text-xs font-medium text-foreground"
              value={ownerBranches.currentLocationId}
              disabled={switchingBranch}
              onChange={(event) => void handleSwitchBranch(event.target.value as Id<"locations">)}
            >
              {ownerBranches.branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="az-top-date">{formatShortDate()}</span>
        <span className="az-status-pulse">
          <i aria-hidden="true" />
          {isOwner ? "Dueño" : "Gerente"}
        </span>
        <NotificationsBell canQuery={canQuery} />
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="az-backdrop-img" src={collageSrc} alt="" />
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
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const current = item.id === activeItem.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              className="az-nav-btn"
              aria-current={current ? "page" : undefined}
            >
              <Icon aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className="az-nav-btn"
          aria-current={inMore ? "page" : undefined}
          onClick={() => setMoreOpen(true)}
        >
          <Menu aria-hidden />
          <span>Más</span>
        </button>
      </nav>

      {moreOpen && (
        <AdminModal title="Más opciones" onClose={() => setMoreOpen(false)}>
          <div className="grid gap-2">
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 font-medium hover:border-foreground"
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setMobileAccountOpen(true);
              }}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 font-medium text-left hover:border-foreground"
            >
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
              <span>{isOwner ? "Código del restaurante y sesión" : "Mi cuenta y sesión"}</span>
            </button>
          </div>
        </AdminModal>
      )}

      {mobileAccountOpen && (
        <AdminModal title="Mi cuenta" onClose={() => setMobileAccountOpen(false)}>
          {accountMenuBody}
        </AdminModal>
      )}

      {confirmRotate && (
        <ConfirmModal
          title="Cambiar código del restaurante"
          message="El código anterior dejará de funcionar para nuevos registros. Tu equipo actual conservará su acceso."
          confirmLabel="Confirmar nuevo código"
          danger
          pending={rotating}
          onConfirm={() => void handleRotateCode()}
          onClose={() => setConfirmRotate(false)}
        />
      )}

      {canQuery && <AssistantDrawer />}
    </div>
  );
}
