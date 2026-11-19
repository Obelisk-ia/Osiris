"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { centsToInput, errorMessage, parseMoneyCents } from "@/lib/format";
import { serviceModes, type ServiceMode } from "@/lib/restaurant-roles";
import { AdminPageHead, ToastBanner, useToast } from "./admin-ui";

export function FeaturesPanel({ preloaded }: { preloaded: Preloaded<typeof api.admin.featuresSnapshot> }) {
  const data = usePreloadedQuery(preloaded);
  const updateFeatures = useMutation(api.admin.updateFeatures);
  const { toast, showToast } = useToast();

  const [lateMinsDraft, setLateMinsDraft] = useState<string | null>(null);
  const [atypicalDraft, setAtypicalDraft] = useState<string | null>(null);
  const [maxQrDraft, setMaxQrDraft] = useState<string | null>(null);
  const [adultDraft, setAdultDraft] = useState<string | null>(null);
  const [childDraft, setChildDraft] = useState<string | null>(null);
  const [savingPrices, setSavingPrices] = useState(false);
  const [tableServiceDraft, setTableServiceDraft] = useState<boolean | null>(null);
  const buffetTableService = tableServiceDraft ?? data.buffetTableService;

  async function savePatch(patch: Parameters<typeof updateFeatures>[0], message: string) {
    try {
      await updateFeatures(patch);
      showToast(message);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos actualizar la configuración."), "err");
    }
  }

  async function saveBuffetPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const adultCents = parseMoneyCents(String(form.get("adult-price") ?? ""));
    const child = String(form.get("child-price") ?? "").trim();
    const childCents = child ? parseMoneyCents(child) : null;
    if (!(adultCents > 0) || (childCents !== null && !(childCents >= 0))) {
      showToast("Escribe una tarifa de adulto mayor a cero y una tarifa de niño válida.", "err");
      return;
    }
    setSavingPrices(true);
    try {
      await updateFeatures({ buffetPrices: { adultCents, childCents } });
      setAdultDraft(null);
      setChildDraft(null);
      showToast("Tarifas de buffet guardadas");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos guardar las tarifas."), "err");
    } finally {
      setSavingPrices(false);
    }
  }

  async function toggleBuffetTableService(enabled: boolean) {
    setTableServiceDraft(enabled);
    await savePatch({ buffetTableService: enabled }, "Servicio de mesas actualizado");
    setTableServiceDraft(null);
  }

  return (
    <div className="az-page narrow">
      <AdminPageHead
        index={6}
        total={8}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Características"
        subtitle="Avisos automáticos y reglas de operación para esta sucursal. Los cambios se guardan en tiempo real."
      />

      <section className="grid gap-3">
        <h2 className="font-heading text-xl font-bold">Automatizaciones</h2>
        <ul className="az-rows">
          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Platillo agotado automático</strong>
                <p className="text-sm text-muted-foreground">
                  Marca como agotados los productos cuyo insumo de receta llegó a cero, en todas las pantallas y en el
                  menú QR.
                </p>
              </div>
              <label className="az-check shrink-0">
                <input
                  type="checkbox"
                  checked={data.autoSoldOut}
                  onChange={(e) =>
                    void savePatch(
                      { autoSoldOut: e.target.checked },
                      `Platillo agotado: ${e.target.checked ? "encendido" : "apagado"}`,
                    )
                  }
                />
                <span>{data.autoSoldOut ? "Encendida" : "Apagada"}</span>
              </label>
            </div>
          </li>

          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Pedido atrasado</strong>
                <p className="text-sm text-muted-foreground">
                  Avisa al gerente cuando un pedido pasa este tiempo en cocina sin marcarse como listo.
                </p>
                <div className="flex items-end gap-2 mt-2">
                  <div className="az-field max-w-[160px]">
                    <label htmlFor="auto-late">Umbral (minutos)</label>
                    <input
                      id="auto-late"
                      type="number"
                      min={1}
                      max={240}
                      disabled={!data.autoLateOrderEnabled}
                      value={lateMinsDraft ?? String(data.autoLateOrderMinutes)}
                      onChange={(e) => setLateMinsDraft(e.target.value)}
                    />
                  </div>
                  {lateMinsDraft !== null && lateMinsDraft !== String(data.autoLateOrderMinutes) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const mins = Number(lateMinsDraft);
                        void savePatch({ autoLateOrderMinutes: mins }, "Umbral de demora actualizado").then(() =>
                          setLateMinsDraft(null),
                        );
                      }}
                    >
                      Guardar
                    </Button>
                  )}
                </div>
              </div>
              <label className="az-check shrink-0">
                <input
                  type="checkbox"
                  checked={data.autoLateOrderEnabled}
                  onChange={(e) =>
                    void savePatch(
                      { autoLateOrderEnabled: e.target.checked },
                      `Pedido atrasado: ${e.target.checked ? "encendida" : "apagada"}`,
                    )
                  }
                />
                <span>{data.autoLateOrderEnabled ? "Encendida" : "Apagada"}</span>
              </label>
            </div>
          </li>

          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Actividad atípica</strong>
                <p className="text-sm text-muted-foreground">
                  Avisa a dueño y gerente cuando un miembro supera este número de cancelaciones o descuentos en un
                  turno.
                </p>
                <div className="flex items-end gap-2 mt-2">
                  <div className="az-field max-w-[160px]">
                    <label htmlFor="auto-atypical">Umbral (acciones)</label>
                    <input
                      id="auto-atypical"
                      type="number"
                      min={1}
                      max={50}
                      disabled={!data.autoAtypicalEnabled}
                      value={atypicalDraft ?? String(data.autoAtypicalThreshold)}
                      onChange={(e) => setAtypicalDraft(e.target.value)}
                    />
                  </div>
                  {atypicalDraft !== null && atypicalDraft !== String(data.autoAtypicalThreshold) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const val = Number(atypicalDraft);
                        void savePatch({ autoAtypicalThreshold: val }, "Umbral de actividad actualizado").then(() =>
                          setAtypicalDraft(null),
                        );
                      }}
                    >
                      Guardar
                    </Button>
                  )}
                </div>
              </div>
              <label className="az-check shrink-0">
                <input
                  type="checkbox"
                  checked={data.autoAtypicalEnabled}
                  onChange={(e) =>
                    void savePatch(
                      { autoAtypicalEnabled: e.target.checked },
                      `Actividad atípica: ${e.target.checked ? "encendida" : "apagada"}`,
                    )
                  }
                />
                <span>{data.autoAtypicalEnabled ? "Encendida" : "Apagada"}</span>
              </label>
            </div>
          </li>

          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Resumen diario</strong>
                <p className="text-sm text-muted-foreground">
                  Al cerrar el turno prepara el resumen de ventas, propinas, cancelaciones e insumos bajo umbral.
                </p>
              </div>
              <label className="az-check shrink-0">
                <input
                  type="checkbox"
                  checked={data.autoDailySummary}
                  onChange={(e) =>
                    void savePatch(
                      { autoDailySummary: e.target.checked },
                      `Resumen diario: ${e.target.checked ? "encendida" : "apagada"}`,
                    )
                  }
                />
                <span>{data.autoDailySummary ? "Encendida" : "Apagada"}</span>
              </label>
            </div>
          </li>
        </ul>
      </section>

      <section className="grid gap-3 mt-2">
        <h2 className="font-heading text-xl font-bold">Reglas de servicio en {data.locationName}</h2>
        <ul className="az-rows">
          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Modalidad de servicio</strong>
                <p className="text-sm text-muted-foreground">
                  {serviceModes.find((mode) => mode.value === data.serviceMode)?.description}
                </p>
              </div>
              <select
                aria-label="Modalidad de servicio"
                className="az-select"
                value={data.serviceMode}
                onChange={(e) =>
                  void savePatch(
                    { serviceMode: e.target.value as ServiceMode },
                    "Modalidad actualizada",
                  )
                }
              >
                {serviceModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
            </div>
          </li>

          {data.serviceMode === "buffet" && (
            <li>
              <div className="grid gap-3 w-full">
                <div className="az-row-main">
                  <div className="az-row-text">
                    <strong>Asignar mesas en el buffet</strong>
                    <p className="text-sm text-muted-foreground">
                      Actívalo para sentar grupos y cargar la entrada por persona a la cuenta. Apágalo si cada grupo elige su lugar.
                    </p>
                  </div>
                  <label className="az-check shrink-0">
                    <input type="checkbox" aria-label="Asignar mesas en el buffet" checked={buffetTableService}
                      disabled={tableServiceDraft !== null}
                      onChange={(event) => void toggleBuffetTableService(event.target.checked)} />
                    <span>{buffetTableService ? "Activo" : "Apagado"}</span>
                  </label>
                </div>
                {buffetTableService && (
                  <form className="grid gap-3" onSubmit={(event) => void saveBuffetPrices(event)}>
                    <div className="az-form-grid">
                      <div className="az-field">
                        <label htmlFor="buffet-adult-price">Tarifa de adulto ({data.currencyCode})</label>
                        <input id="buffet-adult-price" name="adult-price" inputMode="decimal" required
                          value={adultDraft ?? (data.buffetPrices ? centsToInput(data.buffetPrices.adultCents) : "")}
                          onChange={(event) => setAdultDraft(event.target.value)} />
                      </div>
                      <div className="az-field">
                        <label htmlFor="buffet-child-price">Tarifa de niño ({data.currencyCode})</label>
                        <input id="buffet-child-price" name="child-price" inputMode="decimal" aria-describedby="buffet-child-price-note"
                          value={childDraft ?? (data.buffetPrices?.childCents == null ? "" : centsToInput(data.buffetPrices.childCents))}
                          onChange={(event) => setChildDraft(event.target.value)} />
                      </div>
                    </div>
                    <p id="buffet-child-price-note" className="text-sm text-muted-foreground">En blanco usa la tarifa de adulto. Escribe 0 para cortesía.</p>
                    <Button type="submit" variant="outline" size="sm" className="justify-self-start" disabled={savingPrices}>
                      {savingPrices ? "Guardando…" : "Guardar tarifas"}
                    </Button>
                  </form>
                )}
              </div>
            </li>
          )}

          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Pedidos enviados desde QR</strong>
                <p className="text-sm text-muted-foreground">
                  Elige si el mesero debe confirmar cada pedido QR o si entra directo a cocina.
                </p>
                <div className="flex items-end gap-2 mt-2">
                  <div className="az-field max-w-[180px]">
                    <label htmlFor="max-qr">Máx. pendientes por mesa</label>
                    <input
                      id="max-qr"
                      type="number"
                      min={1}
                      max={50}
                      value={maxQrDraft ?? String(data.maxPendingGuestOrders)}
                      onChange={(e) => setMaxQrDraft(e.target.value)}
                    />
                  </div>
                  {maxQrDraft !== null && maxQrDraft !== String(data.maxPendingGuestOrders) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const val = Number(maxQrDraft);
                        void savePatch({ maxPendingGuestOrders: val }, "Límite QR actualizado").then(() =>
                          setMaxQrDraft(null),
                        );
                      }}
                    >
                      Guardar
                    </Button>
                  )}
                </div>
              </div>
              <select
                aria-label="Modo de pedidos QR"
                className="az-select"
                value={data.guestOrderMode}
                onChange={(e) =>
                  void savePatch(
                    { guestOrderMode: e.target.value as "confirmation" | "direct" },
                    "Modo de pedidos QR actualizado",
                  )
                }
              >
                <option value="confirmation">Con confirmación de mesero</option>
                <option value="direct">Directo a cocina</option>
              </select>
            </div>
          </li>

          <li>
            <div className="az-row-main">
              <div className="az-row-text">
                <strong>Restringir meseros a sus mesas asignadas</strong>
                <p className="text-sm text-muted-foreground">
                  Cuando está activo, cada mesero solo ve y atiende las mesas de su sección asignada.
                </p>
              </div>
              <label className="az-check shrink-0">
                <input
                  type="checkbox"
                  checked={data.restrictWaitersToAssignedTables}
                  onChange={(e) =>
                    void savePatch(
                      { restrictWaitersToAssignedTables: e.target.checked },
                      e.target.checked ? "Meseros restringidos a sus secciones" : "Meseros ven todas las mesas",
                    )
                  }
                />
                <span>{data.restrictWaitersToAssignedTables ? "Activa" : "Desactivada"}</span>
              </label>
            </div>
          </li>
        </ul>
      </section>

      <ToastBanner toast={toast} />
    </div>
  );
}
