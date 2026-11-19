import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/restaurant/admin/admin-shell";
import { CashierShell } from "@/components/restaurant/cashier/cashier-shell";
import { WaiterShell } from "@/components/restaurant/waiter/waiter-shell";
import type { StaffRole } from "@/lib/restaurant-roles";
import { requireServiceSession } from "@/lib/service-auth";

async function ServiceShellGate({ children }: { children: ReactNode }) {
  const { registration } = await requireServiceSession();
  const isAdmin = registration.staff.roles.some((role) => role === "owner" || role === "manager");
  const isWaiter = registration.staff.roles.includes("waiter");
  const isCashier = registration.staff.roles.includes("cashier");
  const Shell = isAdmin ? AdminShell : isCashier && !isWaiter ? CashierShell : WaiterShell;
  return (
    <Shell
      initialRestaurantName={registration.restaurant.name}
      initialLocationName={registration.location.name}
      initialStaffName={registration.staff.displayName}
      initialRoles={registration.staff.roles as StaffRole[]}
    >
      {children}
    </Shell>
  );
}

export default function WaiterLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="page-loading" role="status">Cargando servicio…</div>}>
      <ServiceShellGate>{children}</ServiceShellGate>
    </Suspense>
  );
}
