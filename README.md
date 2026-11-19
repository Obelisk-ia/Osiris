# Osiris

Restaurant operations platform built with Next.js 16, React 19, shadcn/ui
(Base UI), and Convex. The Spanish landing and access pages preserve the
editorial design and original collages from `../osiris design`.

> **Guía paso a paso de pruebas manuales y simulación de roles:** consulta **[TESTING.md](./TESTING.md)** para crear usuarios de cada rol (`Dueño`, `Mesero`, `Chef`, `Barra`, `Bartender`, `Barista`, `Caja`), configurar inventario/menú/QR y simular todos los casos de uso (incluyendo la vista QR del comensal y el flujo antifraude *Mesero reporta pago → Caja confirma*).

## Development

```sh
pnpm install
pnpm exec convex dev
```

In a second terminal:

```sh
pnpm dev
```

Open http://localhost:3000. The existing `.env.local` selects the project's
development deployment. `.env.example` lists the required frontend variables.
Never commit secrets or change the deployment target without checking it first.

### Development troubleshooting

If port 3000 belongs to another project, leave it running and choose an explicit
port for Osiris:

```sh
pnpm dev --port 3001
```

Restart `next dev` after installing/updating dependencies. pnpm can change a
package's physical path even when its version stays the same; an already-open
browser or persisted dev compilation can then reference old HMR modules. Stop
the Osiris server first, move `.next/dev` to a temporary backup if necessary,
restart, and hard-refresh the browser. Do not delete application data or stop
another project's server to reset the dev cache.

Next.js 16.4's automatic instant-navigation validator currently fails to load the
lazy client-provider module in Convex Auth 2's SSR integration, even with a fresh
dev cache/browser. `next.config.ts` uses the documented `manual-warning` level as
a development workaround. Cache Components, Partial Prefetching, SSR cookies,
and authorization remain enabled; explicit `instant` exports still opt a route
into validation. Revisit the workaround when upgrading the framework/auth package.

```sh
pnpm test:dev
```

This smoke test reuses Osiris on port 3001 (or starts it if none is running) and
checks real development-mode navigation, reloads, and browser errors. Stop any
Osiris dev server using a different port before running it. The signup and floor
tests are opt-in (see above) because they create development data.

## Password authentication — no email delivery

This app uses **Convex Auth 2**, not the legacy provider-based API. Credentials,
login identifiers, and sessions live in the auth components; `convex/schema.ts`
contains the app profiles and restaurant model. Refresh tokens use httpOnly cookies.
Next.js auth endpoints are allowlisted and protected against cross-site posts.

The supported Convex Auth username/password method creates an account and signs
in immediately. The UI asks for a correo, used only as a case-insensitive login
identifier (maximum 100 characters). **It is not a verified email address** and
must not be used as proof of email ownership. No sender credentials or email
service are needed, and no messages are sent. Password hashing and login rate
limiting are handled by Convex Auth. Password recovery by email is intentionally
unavailable; users must keep their password safe.

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/acceso` | Sign in |
| `/crear-cuenta` | Single owner/employee signup form: account, restaurant details, and roles |
| `/cuenta` | Role router (redirects staff directly to their operational shell) |
| `/cuenta/mesas` | Interactive floor plan for owner/manager/cashier; *Mis mesas* plate checklist for waiters |
| `/cuenta/mesero/mesa/[tableId]` | Order taking and live bill workspace for a table |
| `/cuenta/mesero/cuenta/[accountId]` | Account detail, plate delivery, discounts, payment report & cashier charging |
| `/cuenta/mesero/llevar` | Kanban board for takeaway, pickup, and counter accounts |
| `/cuenta/cocina` | Role-filtered preparation Kanban (`Chef` → Cocina, `Barra` → Barra, `Bartender` → Coctelería, `Barista` → Cafetería) |
| `/cuenta/caja` | Cashier workspace: *Cobrar*, *Turno y corte*, *Ya cobradas*, and *Agotados* |
| `/cuenta/administracion/*` | Owner/manager suite: Inventario, Menú, Buffet, Códigos QR, Características, Miembros, Sucursales |
| `/mesa/[qrToken]` | Public QR diner view: live menu, table bill status, *Llamar al mesero*, and delivery-gated *Pedir la cuenta* |
| `/menu/[locationId]` | Public read-only digital menu for a branch |

New passwords require at least 10 characters (Convex Auth's policy).
Registration uses one form: choose **Soy dueño** or **Soy empleado**, enter your
name and restaurant details, then your login credentials. A single submission
creates the account, saves membership, and opens `/cuenta` directly. There is no
separate onboarding screen.
Owners enter their name and restaurant name. One transaction creates the
restaurant, first location, owner membership, folio counter, and restaurant code.
Staff enter their name, that code, and any combination of three selections:
**Mesero**, **Cocina y barra**, and **Caja**. Cocina y barra is a single choice
that covers chef, bartender and barista, so the person can work every
kitchen/bar station; those remain three distinct stored roles because stations
are permissioned individually. Joining is immediate: **there is no approval step**.

Internally, account creation and restaurant registration remain two authenticated
operations. Invalid codes and retryable registration errors stay on the signup
form without losing its entered details or creating another account on retry.
Interrupted accounts resume at `/crear-cuenta` after reload/sign-in; existing
members skip signup and go directly to the dashboard. No password is persisted
in a signup draft.

Each person currently belongs to one restaurant/primary location. Repeating
registration never creates a duplicate or changes existing roles. Owner/manager
roles cannot be self-selected through the staff registration endpoint. An inactive
membership cannot reactivate itself by entering the code again.

Only the owner can retrieve and rotate the code. Rotation blocks new registrations
using the old code without removing existing members. Treat the code as a bearer
invitation: anyone who receives it can join and choose operational roles, including
cashier. Share it privately and rotate it if it leaks. Joining requires an authenticated
session and is rate-limited per user and connection; failed attempts commit the
limit usage rather than rolling it back.

The workspace picker reflects the selected roles. Views show at most 50 scoped
records, with authorization also enforced on the server and in Convex. They are
read-only foundations, **not completed POS/kitchen/buffet operational screens**.

## Mesas · owner floor plan

Ported from the original Osiris demo (`../osiris design/js/service.js` and
`admin.js`). Owners and managers open `/cuenta/mesas` and get a floor plan
instead of the previous read-only list:

- **Sections** are placed and sized on a 0–100 grid. Add, rename, describe and
  assign a waiter; move and resize them by dragging their bar or corner.
  Sections may overlap: moving one brings it to the front, and the section
  editor has explicit “Traer al frente” / “Enviar al fondo” controls.
  The canvas grows dynamically with the lowest section, live while dragging,
  and keeps the same size in edit and view mode so nothing is cropped.
- **Table types** define a name, shape (round, square, rectangle or oval) and
  seat count. Tables can use a type or stay custom.
- **Tables** get an automatic free starting spot inside their section, then are
  positioned by pointer drag or keyboard arrows. Dragging never opens the edit
  form. Tables can be moved between sections, renamed or removed.
  Each shows a top-down SVG with chairs according to its shape and seats.
- **Status** badges and filter chips: Libre, Ocupada, Pedido listo and Quieren
  pagar. Status comes from open accounts when a table has one; until then an
  owner can preview it from the table editor.
- Sections with active tables and types in use cannot be deleted.

Floor writes are owner/manager-only; active waiters can read the plan read-only
and kitchen/cashier roles cannot access it. All reads and writes are scoped to
the caller's location. The waiter's own "Mis mesas" action list, QR print flow
and account-driven status changes are **not** part of this first pass.

The live dev test is opt-in because it creates accounts, a restaurant and floor
data in the development backend:

```sh
OSIRIS_TEST_LIVE_FLOOR=1 pnpm test:dev
```

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:dev
```

Backend tests use in-memory Convex components without email or Resend components:
they do not send emails or modify deployment data. After `pnpm build`, browser
smoke tests start a separate production server on port 3100 without creating accounts.

To verify live signup, explicitly opt in on the **development backend**:

```sh
OSIRIS_TEST_LIVE_SIGNUP=1 pnpm test:dev
```

This leaves two disposable accounts and one clearly named test restaurant in
development. It checks owner and multi-role employee signup, invalid-code
correction/resume, direct dashboard entry, reload, and sign-out/sign-in. Default
smoke tests do not create accounts. No mailbox access or email links are involved.

## Postgres to Convex

`schema.sql` remains the unchanged reference, not a migration to run. This is a
fresh app with no historical Postgres data to import. `convex/schema.ts` now models
the SQL entities with typed document relationships, camelCase field/table names,
and indexes. It adds the app `users` table and `buffetBatches`.

| SQL group | Convex tables |
| --- | --- |
| Identity/onboarding | `organizations`, `locations`, `staff`, `organizationCodes` |
| Menu/modifiers | `dishCategories`, `dishes`, `dishIngredients`, `modifierGroups`, `modifierOptions`, `dishModifierGroups` |
| Stock/recipes | `inventoryItems`, `inventoryBalances`, `inventoryMovements`, `recipeIngredients`, `modifierRecipeIngredients` |
| Floor/stations | `sections`, `tableTypes`, `diningTables`, `sectionAssignments`, `preparationStations`, `dishStations` |
| Accounts/orders | `accounts`, `accountFolioCounters`, `accountAssignments`, `orders`, `orderItems`, `orderItemPreparations`, `orderItemModifiers` |
| Buffet | `buffetMenus`, `buffetMenuDishes`, `buffetDiners`, `buffetServings`, plus `buffetBatches` |
| QR guests | `guestSessions`, `guestOrderSubmissions`, `guestOrderItems`, `guestOrderItemModifiers`, `serviceRequests` |

Intentional differences from the SQL:

- `staff.roles` is a bounded, deduplicated role list, not one role per person.
- Money uses integer **cents**; inventory uses integer **millionths of the base
  unit** (`g`, `ml`, or `each`). Workflow arithmetic rejects unsafe integers.
- `_id` and `_creationTime` replace generated UUIDs and creation timestamps.
  Other instants use epoch milliseconds; buffet menu dates stay local `YYYY-MM-DD`.
- Orders always reference an account, but a dining table is optional. Counter,
  takeaway and pickup no longer require a physical table.
- Dish images reference Convex `_storage` IDs, not Postgres storage bucket paths.
- QR guest access is modeled separately with a token hash; guest sessions are not
  staff or Supabase Auth users. Its public access flow is not implemented yet.
- Onboarding defaults to MXN, America/Mexico_City, and mixed à-la-carte/buffet service.
- Code queries are owner-only; operational permissions derive from the session,
  never from a caller-supplied identity or a frontend-selected role.

### Preparation and inventory

`convex/preparation.ts` implements internal, authenticated preparation-start
transactions. Starting the first station for an order item consumes its recipe
and snapshotted modifier deltas, writes append-only stock movements, and advances
preparation status atomically. Retries or additional stations do not consume again.
Insufficient stock rolls back **every** ingredient and status update. Chefs,
bartenders, and baristas can start only their station types (owners/managers can
access all station types at their location).

Buffet preparation consumes the recipe once per `buffetBatches` record, multiplied
by its prepared portions. Serving the resulting food must not consume it again.
These functions remain internal until the operational UI supports the full
lifecycle. Base recipe quantities are read at preparation start; modifier deltas
are order-time snapshots. A cancellation after preparation must be handled as a
separate waste/correction workflow, not by deleting ledger entries.

### Remaining backend/UI work

The schema is **not** a substitute for every SQL trigger, constraint, or policy.
Only onboarding, scoped read views, and preparation-start workflows are implemented
and tested so far. There is no generic CRUD endpoint exposing the other tables.
Before adding those writes, implement their tenant checks, numeric validation,
uniqueness/idempotency checks, state transitions, and archival rules in mutations.
Open-account uniqueness, QR access/approval, menu/floor editing, stock receipts and
transfers, serving/delivery, cash shifts, manual payments, refunds, and reports are
still pending. Online payments are deliberately excluded for now.
