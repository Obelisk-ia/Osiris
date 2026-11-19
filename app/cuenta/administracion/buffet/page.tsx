import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { BuffetPanel } from "@/components/restaurant/admin/buffet-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Buffet" };

async function BuffetContent() {
  const { options, registration } = await requireAdminSession();
  if (registration.location.serviceMode === "a_la_carte") redirect("/cuenta/administracion/caracteristicas");
  const preloaded = await preloadQuery(api.buffet.snapshot, {}, options);
  return <BuffetPanel preloaded={preloaded} />;
}

export default function BuffetPage() {
  return (
    <Suspense fallback={<p role="status">Cargando buffet…</p>}>
      <BuffetContent />
    </Suspense>
  );
}
