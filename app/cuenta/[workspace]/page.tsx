import { fetchQuery, preloadQuery } from "convex/nextjs";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { Brand } from "@/components/brand";
import { AdminShell } from "@/components/restaurant/admin/admin-shell";
import { CashierPanel } from "@/components/restaurant/cashier/cashier-panel";
import { CashierShell } from "@/components/restaurant/cashier/cashier-shell";
import { FloorPanel } from "@/components/restaurant/floor/floor-panel";
import { KitchenPanel } from "@/components/restaurant/kitchen/kitchen-panel";
import { KitchenShell } from "@/components/restaurant/kitchen/kitchen-shell";
import { WaiterShell } from "@/components/restaurant/waiter/waiter-shell";
import { WaiterTablesPanel } from "@/components/restaurant/waiter/waiter-tables-panel";
import { WorkspacePanel } from "@/components/restaurant/workspace-panel";
import { convexAuthNextjsAccessToken, isAuthenticatedNextjs } from "@/lib/convex-auth";
import { canAccessWorkspace, workspaces, type StaffRole } from "@/lib/restaurant-roles";

async function WorkspaceContent({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const definition = workspaces.find((entry) => entry.value === workspace);
  if (!definition) notFound();
  if (!(await isAuthenticatedNextjs())) redirect("/acceso");
  const token = await convexAuthNextjsAccessToken();
  const options = { token: token ?? undefined };
  const registration = await fetchQuery(api.restaurants.current, {}, options);
  if (!registration?.staff.isActive || !canAccessWorkspace(registration.staff.roles, definition.value)) redirect("/cuenta");

  const isAdmin = registration.staff.roles.some((role) => role === "owner" || role === "manager");
  const isWaiter = registration.staff.roles.includes("waiter");
  const isCashier = registration.staff.roles.includes("cashier");

  if (definition.value === "mesas") {
    if (isAdmin) {
      const floor = await preloadQuery(api.floor.snapshot, {}, options);
      return (
        <AdminShell
          initialRestaurantName={registration.restaurant.name}
          initialLocationName={registration.location.name}
          initialStaffName={registration.staff.displayName}
          initialRoles={registration.staff.roles as StaffRole[]}
        >
          <FloorPanel preloaded={floor} embedded locationName={registration.location.name} />
        </AdminShell>
      );
    }
    if (isCashier && !isWaiter) {
      const floor = await preloadQuery(api.floor.snapshot, {}, options);
      return (
        <CashierShell
          initialRestaurantName={registration.restaurant.name}
          initialLocationName={registration.location.name}
          initialStaffName={registration.staff.displayName}
          initialRoles={registration.staff.roles as StaffRole[]}
        >
          <FloorPanel preloaded={floor} embedded locationName={registration.location.name} />
        </CashierShell>
      );
    }
    const waiterTables = await preloadQuery(api.waiter.tablesSnapshot, {}, options);
    return (
      <WaiterShell
        initialRestaurantName={registration.restaurant.name}
        initialLocationName={registration.location.name}
        initialStaffName={registration.staff.displayName}
        initialRoles={registration.staff.roles as StaffRole[]}
      >
        <WaiterTablesPanel preloaded={waiterTables} />
      </WaiterShell>
    );
  }

  if (definition.value === "caja") {
    const cashier = await preloadQuery(api.cashier.snapshot, {}, options);
    if (isAdmin) {
      return (
        <AdminShell
          initialRestaurantName={registration.restaurant.name}
          initialLocationName={registration.location.name}
          initialStaffName={registration.staff.displayName}
          initialRoles={registration.staff.roles as StaffRole[]}
        >
          <CashierPanel preloaded={cashier} pageIndex={3} pageTotal={10} />
        </AdminShell>
      );
    }
    return (
      <CashierShell
        initialRestaurantName={registration.restaurant.name}
        initialLocationName={registration.location.name}
        initialStaffName={registration.staff.displayName}
        initialRoles={registration.staff.roles as StaffRole[]}
      >
        <CashierPanel preloaded={cashier} pageIndex={1} pageTotal={3} />
      </CashierShell>
    );
  }

  if (definition.value === "cocina") {
    const kitchen = await preloadQuery(api.kitchen.snapshot, {}, options);
    if (isAdmin) {
      return (
        <AdminShell
          initialRestaurantName={registration.restaurant.name}
          initialLocationName={registration.location.name}
          initialStaffName={registration.staff.displayName}
          initialRoles={registration.staff.roles as StaffRole[]}
        >
          <KitchenPanel preloaded={kitchen} />
        </AdminShell>
      );
    }
    return (
      <KitchenShell
        initialRestaurantName={registration.restaurant.name}
        initialLocationName={registration.location.name}
        initialStaffName={registration.staff.displayName}
        initialRoles={registration.staff.roles as StaffRole[]}
      >
        <KitchenPanel preloaded={kitchen} />
      </KitchenShell>
    );
  }

  const preloaded = await preloadQuery(api.workspaces.snapshot, { workspace: definition.value }, options);
  return (
    <main className="site-wrap account-wrap">
      <Brand />
      <WorkspacePanel preloaded={preloaded} />
    </main>
  );
}

export default function WorkspacePage({ params }: { params: Promise<{ workspace: string }> }) {
  return (
    <Suspense fallback={<div className="page-loading" role="status">Cargando tu área de trabajo…</div>}>
      <WorkspaceContent params={params} />
    </Suspense>
  );
}
