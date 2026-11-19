import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { QrPanel } from "@/components/restaurant/admin/qr-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Códigos QR" };

async function QrContent() {
  const { options, registration } = await requireAdminSession();
  const preloaded = await preloadQuery(api.floor.snapshot, {}, options);
  return (
    <QrPanel
      preloaded={preloaded}
      locationId={registration.location._id}
      locationName={registration.location.name}
    />
  );
}

export default function QrPage() {
  return (
    <Suspense fallback={<p role="status">Cargando códigos QR…</p>}>
      <QrContent />
    </Suspense>
  );
}
