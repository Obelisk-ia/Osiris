import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/restaurant/admin/admin-shell";
import { requireAdminSession } from "@/lib/admin-auth";
import type { StaffRole } from "@/lib/restaurant-roles";

async function AdminShellGate({ children }: { children: ReactNode }) {
  const { registration } = await requireAdminSession();
  return (
    <AdminShell
      initialRestaurantName={registration.restaurant.name}
      initialLocationName={registration.location.name}
      initialStaffName={registration.staff.displayName}
      initialRoles={registration.staff.roles as StaffRole[]}
      initialServiceMode={registration.location.serviceMode}
    >
      {children}
    </AdminShell>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="page-loading" role="status">Cargando administración…</div>}>
      <AdminShellGate>{children}</AdminShellGate>
    </Suspense>
  );
}
