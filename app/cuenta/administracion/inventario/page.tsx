import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { InventoryPanel } from "@/components/restaurant/admin/inventory-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Inventario" };

async function InventoryContent() {
  const { options } = await requireAdminSession();
  const preloaded = await preloadQuery(api.inventory.snapshot, {}, options);
  return <InventoryPanel preloaded={preloaded} />;
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<p role="status">Cargando inventario…</p>}>
      <InventoryContent />
    </Suspense>
  );
}
