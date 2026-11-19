import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { MembersPanel } from "@/components/restaurant/admin/members-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Miembros" };

async function MembersContent() {
  const { options } = await requireAdminSession();
  const preloaded = await preloadQuery(api.admin.membersSnapshot, {}, options);
  return <MembersPanel preloaded={preloaded} />;
}

export default function MembersPage() {
  return (
    <Suspense fallback={<p role="status">Cargando miembros…</p>}>
      <MembersContent />
    </Suspense>
  );
}
