import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatMoney, todayIsoDate } from "@/lib/format";

function groupByStation<Dish extends { destination: string }>(dishes: Dish[]) {
  const stations = new Map<string, Dish[]>();
  for (const dish of dishes) {
    const station = stations.get(dish.destination);
    if (station) station.push(dish);
    else stations.set(dish.destination, [dish]);
  }
  return Array.from(stations);
}

export function BuffetToday({
  locationId,
  timeZone,
  currencyCode,
  buffetOnly,
}: {
  locationId: Id<"locations">;
  timeZone: string;
  currencyCode: string;
  buffetOnly: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refreshDate = () => setNow(Date.now());
    const timer = window.setInterval(refreshDate, 30_000);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, []);

  const data = useQuery(api.buffet.publicMenuForDate, { locationId, menuDate: todayIsoDate(timeZone, new Date(now)) });
  if (!data) return buffetOnly ? <p role="status" className="text-sm text-muted-foreground">Cargando el buffet…</p> : null;
  if (!buffetOnly && data.menus.length === 0) return null;
  const MenuTitle = buffetOnly ? "h2" : "h3";

  return (
    <section aria-label="Hoy en el buffet" className="grid gap-4">
      {!buffetOnly && (
        <h2 className="font-heading text-2xl font-extrabold tracking-tight">Hoy en el buffet</h2>
      )}
      {data.prices && (
        <div className="az-card">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="text-sm text-muted-foreground">Entrada de adulto</dt>
              <dd className="az-money font-semibold">{formatMoney(data.prices.adultCents, currencyCode)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Entrada de niño</dt>
              <dd className="az-money font-semibold">{data.prices.childCents === 0
                ? "Cortesía"
                : formatMoney(data.prices.childCents ?? data.prices.adultCents, currencyCode)}</dd>
            </div>
          </dl>
        </div>
      )}
      {data.menus.length === 0 && (
        <p className="az-card text-sm">El menú de buffet de hoy aún no está publicado.</p>
      )}
      {data.menus.map((menu) => (
        <article key={menu._id} className="az-card grid gap-4">
          <MenuTitle className="font-heading text-xl font-extrabold tracking-tight">{menu.name}</MenuTitle>
          <div className="grid gap-5 sm:grid-cols-2">
            {groupByStation(menu.dishes).map(([station, dishes]) => (
              <div key={station} className="grid content-start gap-2">
                <p className="border-b border-border pb-2 text-sm font-semibold">{station}</p>
                <ul className="grid gap-3">
                  {dishes.map((dish) => (
                    <li key={dish._id} className="flex items-start gap-3">
                      {dish.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={dish.photoUrl} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
                      )}
                      <div className="min-w-0">
                        <strong className="text-sm font-semibold">{dish.name}</strong>
                        {dish.description && <p className="text-sm text-muted-foreground">{dish.description}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
