"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { Check, Download, EyeOff, Printer, QrCode, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.floor.snapshot>>>;
type TableItem = Snapshot["tables"][number];

function qrPathFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const n = 29;
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inFinder(x, y) && rand() > 0.5) {
        d += `M${x + 2} ${y + 2}h1v1h-1z`;
      }
    }
  }
  for (const [ox, oy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]) {
    const X = ox + 2;
    const Y = oy + 2;
    d += `M${X} ${Y}h7v7h-7zM${X + 1} ${Y + 1}v5h5v-5zM${X + 2} ${Y + 2}h3v3h-3z`;
  }
  return d;
}

function qrSvgString(tableNumber: string, seed: string) {
  const path = qrPathFor(seed);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33" role="img" aria-label="Código QR de ${tableNumber}" shape-rendering="crispEdges"><rect width="33" height="33" fill="#ffffff"/><path fill="#15140f" fill-rule="evenodd" d="${path}"/></svg>`;
}

export function QrPanel({
  preloaded,
  locationName,
}: {
  preloaded: Preloaded<typeof api.floor.snapshot>;
  locationName: string;
}) {
  const data = usePreloadedQuery(preloaded);
  const { toast, showToast } = useToast();

  const regenerateQr = useMutation(api.floor.regenerateTableQr);
  const setQrEnabled = useMutation(api.floor.setTableQrEnabled);

  const [selectedId, setSelectedId] = useState<Id<"diningTables"> | null>(null);
  const [confirmRegen, setConfirmRegen] = useState<TableItem | null>(null);
  const [pending, setPending] = useState(false);

  const sectionNames = useMemo(
    () => new Map(data.sections.map((s) => [s._id, s.name] as const)),
    [data.sections],
  );

  const selectedTable = selectedId ? data.tables.find((t) => t._id === selectedId) ?? null : null;

  function downloadSvg(table: TableItem) {
    const seed = `${table._id}:${table.qrToken}`;
    const svg = qrSvgString(table.tableNumber, seed);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr_${table.tableNumber.replace(/\s+/g, "_").toLowerCase()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("Código QR descargado");
  }

  function printQr(table: TableItem) {
    const seed = `${table._id}:${table.qrToken}`;
    const svg = qrSvgString(table.tableNumber, seed);
    const win = window.open("", "_blank", "width=420,height=560");
    if (!win) {
      showToast("Tu navegador bloqueó la ventana de impresión.", "err");
      return;
    }
    const doc = win.document;
    doc.open();
    doc.write(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>QR · ${table.tableNumber}</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#15140f}svg{width:240px;height:240px;margin:16px auto;display:block}h1{margin:0 0 4px;font-size:24px}p{margin:4px 0;color:#5a5448;font-size:14px}</style></head><body><h1>${data.restaurantName}</h1><p>${table.tableNumber} · Versión ${table.qrVersion ?? 1}</p>${svg}<p>Escanea para ver el menú y pedir</p></body></html>`);
    doc.close();
    win.focus();
    win.print();
  }

  async function handleRegenerate() {
    if (!confirmRegen) return;
    setPending(true);
    try {
      const res = await regenerateQr({ tableId: confirmRegen._id });
      showToast(`Código regenerado · Versión ${res.qrVersion}`);
      setConfirmRegen(null);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos regenerar el código."), "err");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="az-page">
      <AdminPageHead
        index={5}
        total={8}
        restaurantName={data.restaurantName}
        locationName={locationName}
        title="Códigos QR"
        subtitle="Cada mesa tiene su propio código QR único. Las mesas se agregan y acomodan desde Mesas con Editar plano."
        actions={
          <Link
            href="/cuenta/mesas"
            className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:border-foreground"
          >
            Ir al plano de mesas
          </Link>
        }
      />

      {data.tables.length > 0 ? (
        <ul className="az-rows">
          {data.tables.map((table) => {
            const sectionName = sectionNames.get(table.sectionId) ?? "Sección";
            const version = table.qrVersion ?? 1;
            return (
              <li key={table._id}>
                <div className="az-row-main">
                  <div className="az-row-text">
                    <div className="az-cluster">
                      <strong>{table.tableNumber}</strong>
                      {table.qrEnabled ? (
                        <span className="az-badge success">
                          <Check aria-hidden="true" />
                          Activo
                        </span>
                      ) : (
                        <span className="az-badge">
                          <EyeOff aria-hidden="true" />
                          Pausado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {sectionName} · Versión {version} del código · {table.seatCount} pers.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(table._id)}>
                    <QrCode className="size-4" aria-hidden="true" />
                    Ver código
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<QrCode className="size-7" aria-hidden="true" />}
          title="Todavía no hay mesas"
          description="Cuando agregues mesas en tu plano, cada una generará automáticamente su código QR aquí."
          action={
            <Link
              href="/cuenta/mesas"
              className="inline-flex items-center justify-center rounded-full bg-foreground text-card px-5 py-2.5 text-sm font-semibold mt-2"
            >
              Configurar plano de mesas
            </Link>
          }
        />
      )}

      {selectedTable && (
        <AdminModal title={`Código QR de ${selectedTable.tableNumber}`} onClose={() => setSelectedId(null)}>
          <div className="az-qr-box">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 33 33"
              role="img"
              aria-label={`Código QR de ${selectedTable.tableNumber}`}
              shapeRendering="crispEdges"
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                d={qrPathFor(`${selectedTable._id}:${selectedTable.qrToken}`)}
              />
            </svg>
          </div>

          <p className="text-sm text-muted-foreground">
            <strong>Versión {selectedTable.qrVersion ?? 1}.</strong> Cada código identifica de forma única a esta mesa.
            Si el código impreso se extravía, regenerarlo invalida inmediatamente el anterior. El menú interactivo del
            comensal se conectará en la siguiente etapa.
          </p>

          <div className="grid gap-2">
            <Button variant="outline" onClick={() => downloadSvg(selectedTable)}>
              <Download className="size-4" aria-hidden="true" />
              Descargar SVG
            </Button>
            <Button variant="outline" onClick={() => printQr(selectedTable)}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir código
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await setQrEnabled({ tableId: selectedTable._id, enabled: !selectedTable.qrEnabled });
                  showToast(selectedTable.qrEnabled ? "Código pausado" : "Código activado");
                } catch (cause) {
                  showToast(errorMessage(cause), "err");
                }
              }}
            >
              {selectedTable.qrEnabled ? "Pausar código QR" : "Activar código QR"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmRegen(selectedTable)}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Regenerar código
            </Button>
          </div>
        </AdminModal>
      )}

      {confirmRegen && (
        <ConfirmModal
          title={`Regenerar QR de ${confirmRegen.tableNumber}`}
          message="El código impreso actual dejará de funcionar y tendrás que colocar el nuevo código en la mesa."
          confirmLabel="Regenerar"
          danger
          pending={pending}
          onConfirm={() => void handleRegenerate()}
          onClose={() => setConfirmRegen(null)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}
