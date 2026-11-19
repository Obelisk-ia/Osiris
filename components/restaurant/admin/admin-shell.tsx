"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  BookOpen,
  Building2,
  Check,
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
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatRoles, type StaffRole } from "@/lib/restaurant-roles";
import { errorMessage, formatShortDate, initials, toRoman } from "@/lib/format";
import { AdminModal, ConfirmModal } from "./admin-ui";

export type AdminNavItem = {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { id: "mesas", label: "Mesas", href: "/cuenta/mesas", icon: Grid2x2 },
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
  const restaurantName = live?.restaurant.name ?? initialRestaurantName;
  const locationName = live?.location.name ?? initialLocationName;
  const staffName = live?.staff.displayName ?? initialStaffName;
  const roles = (live?.staff.roles ?? initialRoles) as readonly StaffRole[];
  const isOwner = roles.includes("owner");
  const roleLabel = formatRoles(roles).join(" · ");

  const ownerCode = useQuery(api.restaurants.ownerCode, canQuery && isOwner ? {} : "skip");
  const rotateCode = useMutation(api.restaurants.rotateCode);

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

  const activeItem =
    ADMIN_NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ??
    ADMIN_NAV_ITEMS[0];

  const primaryItems = ADMIN_NAV_ITEMS.filter((item) => MOBILE_PRIMARY_IDS.has(item.id));
  const secondaryItems = ADMIN_NAV_ITEMS.filter((item) => !MOBILE_PRIMARY_IDS.has(item.id));
  const inMore = secondaryItems.some((item) => item.id === activeItem.id);
  const collageSrc = isOwner ? "/collage/osiris.webp" : "/collage/thot.webp";

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
        <Link className="brand" href="/cuenta/mesas">
          <span className="brand-mark" aria-hidden="true">Ø</span>
          <strong>Osiris</strong>
        </Link>
        <nav className="az-side-nav" aria-label="Pantallas de administración">
          {ADMIN_NAV_ITEMS.map((item, idx) => {
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
                <span>{item.label}</span>
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
        <span className="az-top-date">{formatShortDate()}</span>
        <span className="az-status-pulse">
          <i aria-hidden="true" />
          {isOwner ? "Dueño" : "Gerente"}
        </span>
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
    </div>
  );
}
