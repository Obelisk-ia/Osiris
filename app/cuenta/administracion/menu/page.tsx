import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { MenuPanel } from "@/components/restaurant/admin/menu-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Menú" };

async function MenuContent() {
  const { options } = await requireAdminSession();
  const preloaded = await preloadQuery(api.menu.snapshot, {}, options);
  return <MenuPanel preloaded={preloaded} />;
}

export default function MenuPage() {
  return (
    <Suspense fallback={<p role="status">Cargando menú…</p>}>
      <MenuContent />
    </Suspense>
  );
}
