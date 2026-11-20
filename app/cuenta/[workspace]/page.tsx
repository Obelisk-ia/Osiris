import { fetchQuery, preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { Brand } from "@/components/brand";
import { AdminShell } from "@/components/restaurant/admin/admin-shell";
import { BuffetServicePanel } from "@/components/restaurant/buffet/buffet-service-panel";
import { CashierPanel } from "@/components/restaurant/cashier/cashier-panel";
import { CashierShell } from "@/components/restaurant/cashier/cashier-shell";
import { FloorPanel } from "@/components/restaurant/floor/floor-panel";
import { KitchenPanel } from "@/components/restaurant/kitchen/kitchen-panel";
import { KitchenShell } from "@/components/restaurant/kitchen/kitchen-shell";
import { WaiterShell } from "@/components/restaurant/waiter/waiter-shell";
import { WaiterTablesPanel } from "@/components/restaurant/waiter/waiter-tables-panel";
import { WorkspacePanel } from "@/components/restaurant/workspace-panel";
import { convexAuthNextjsAccessToken, isAuthenticatedNextjs } from "@/lib/convex-auth";
import { canAccessWorkspace, usesAssignedTables, workspaces, type StaffRole } from "@/lib/restaurant-roles";

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
  const shellProps = {
    initialRestaurantName: registration.restaurant.name,
    initialLocationName: registration.location.name,
    initialStaffName: registration.staff.displayName,
    initialRoles: registration.staff.roles as StaffRole[],
    initialServiceMode: registration.location.serviceMode,
    initialBuffetTableService: registration.location.buffetTableService,
  };

  if (definition.value === "mesas") {
    if (isAdmin) {
      const floor = await preloadQuery(api.floor.snapshot, {}, options);
      return (
        <AdminShell {...shellProps}>
          <FloorPanel preloaded={floor} embedded locationName={registration.location.name}
            allowBuffetSeating={registration.location.serviceMode === "buffet" && usesAssignedTables(registration.location)} />
        </AdminShell>
      );
    }
    if (isCashier && !isWaiter) {
      const floor = await preloadQuery(api.floor.snapshot, {}, options);
      return (
        <CashierShell {...shellProps}>
          <FloorPanel preloaded={floor} embedded locationName={registration.location.name} />
        </CashierShell>
      );
    }
    const waiterTables = await preloadQuery(api.waiter.tablesSnapshot, {}, options);
    const tables = preloadedQueryResult(waiterTables);
    if (!tables.tableServiceEnabled && tables.busyTables.length === 0) redirect("/cuenta/buffet");
    return (
      <WaiterShell {...shellProps}>
        <WaiterTablesPanel preloaded={waiterTables} />
      </WaiterShell>
    );
  }

  if (definition.value === "caja") {
    const cashier = await preloadQuery(api.cashier.snapshot, {}, options);
    if (isAdmin) {
      return (
        <AdminShell {...shellProps}>
          <CashierPanel preloaded={cashier} pageIndex={3} pageTotal={10} />
        </AdminShell>
      );
    }
    return (
      <CashierShell {...shellProps}>
        <CashierPanel preloaded={cashier} pageIndex={1} pageTotal={3} />
      </CashierShell>
    );
  }

  if (definition.value === "cocina") {
    const kitchen = await preloadQuery(api.kitchen.snapshot, {}, options);
    if (isAdmin) {
      return (
        <AdminShell {...shellProps}>
          <KitchenPanel preloaded={kitchen} />
        </AdminShell>
      );
    }
    return (
      <KitchenShell {...shellProps}>
        <KitchenPanel preloaded={kitchen} />
      </KitchenShell>
    );
  }

  if (definition.value === "buffet") {
    if (registration.location.serviceMode === "a_la_carte" &&
        !(await fetchQuery(api.buffet.hasOpenReplenishments, {}, options))) redirect("/cuenta/mesas");
    const Shell = isAdmin ? AdminShell : WaiterShell;
    return (
      <Shell {...shellProps}>
        <BuffetServicePanel timeZone={registration.location.timeZone} isAdmin={isAdmin} />
      </Shell>
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
