import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { BranchesPanel } from "@/components/restaurant/admin/branches-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Sucursales" };

async function BranchesContent() {
  const { options, registration } = await requireAdminSession();
  if (!registration.staff.roles.includes("owner")) {
    redirect("/cuenta/mesas");
  }
  const preloaded = await preloadQuery(api.admin.branchesSnapshot, {}, options);
  return <BranchesPanel preloaded={preloaded} />;
}

export default function BranchesPage() {
  return (
    <Suspense fallback={<p role="status">Cargando sucursales…</p>}>
      <BranchesContent />
    </Suspense>
  );
}
