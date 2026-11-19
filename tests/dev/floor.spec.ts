import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("owner builds a floor plan: sections, types, tables, status and placement", async ({ page }) => {
  test.skip(process.env.OSIRIS_TEST_LIVE_FLOOR !== "1", "Opt in: creates disposable accounts and restaurant data in the development backend.");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().split("\n")[0]); });
  const id = randomUUID();
  const email = `floor-owner-${id}@example.invalid`;
  const password = `Cedar meadow! ${randomUUID()}`;
  const restaurant = `Floor test ${id}`;

  await page.goto("http://localhost:3001/crear-cuenta");
  await page.getByLabel("Tu nombre", { exact: true }).fill("Floor Owner");
  await page.getByLabel("Nombre del restaurante", { exact: true }).fill(restaurant);
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/cuenta\/mesas$/, { timeout: 30_000 });
  await expect(page.getByText("Tu plano está vacío.")).toBeVisible();
  await expect(page.getByText("0 Libres")).toBeVisible();

  // Section
  await page.getByRole("button", { name: "Agregar la primera sección" }).click();
  await page.getByLabel("Nombre de la sección").fill("Salón principal");
  await page.getByLabel("Descripción de la sección").fill("Comedor junto a la ventana");
  await page.getByRole("button", { name: "Agregar sección", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salón principal", exact: true })).toBeVisible();
  await expect(page.getByText("Comedor junto a la ventana")).toBeVisible();

  // Table type
  await page.getByRole("button", { name: "Tipos de mesa" }).click();
  await page.getByRole("button", { name: "Nuevo tipo", exact: true }).click();
  await page.getByLabel("Nombre del tipo").fill("Redonda de 4");
  await page.getByLabel("Forma del tipo").selectOption("round");
  await page.getByLabel("Sillas del tipo").fill("4");
  await page.getByRole("button", { name: "Crear tipo", exact: true }).click();
  await expect(page.getByText("Redonda de 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  // Table from the type
  await page.getByRole("button", { name: "Mesa", exact: true }).click();
  await page.getByLabel("Nombre de la mesa").fill("Mesa 1");
  await page.getByLabel("Tipo de mesa").selectOption({ label: "Redonda de 4 · 4 pers." });
  await page.getByRole("button", { name: "Agregar mesa", exact: true }).click();
  const table = page.locator("[data-table]");
  await expect(table).toBeVisible();
  await expect(table.locator(".floor-table-svg circle.floor-surface")).toBeVisible();
  await expect(page.getByText("1 Libres")).toBeVisible();

  // Status preview, badges and filters
  await table.click();
  await expect(page.getByLabel("X de la mesa")).toHaveCount(0);
  await expect(page.getByLabel("Y de la mesa")).toHaveCount(0);
  await page.getByLabel("Estado de la mesa").selectOption("occupied");
  await expect(page.getByLabel("Estado de la mesa")).toHaveValue("occupied");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  const canvasSize = await page.locator(".floor").getAttribute("style");
  await page.getByRole("button", { name: "Terminar", exact: true }).click();
  await expect(page.locator(".floor")).toHaveAttribute("style", canvasSize!);
  await expect(table).toHaveAttribute("aria-label", /Mesa 1, Ocupada/);
  await expect(page.getByText("1 Ocupadas")).toBeVisible();
  await page.getByRole("button", { name: "Libres", exact: true }).click();
  await expect(table).toHaveClass(/dim/);
  await page.getByRole("button", { name: "Ocupadas", exact: true }).click();
  await expect(table).not.toHaveClass(/dim/);
  await page.getByRole("button", { name: "Todas", exact: true }).click();

  // Placement: keyboard and pointer, persisted across reload
  await page.getByRole("button", { name: "Editar plano", exact: true }).click();
  const beforeKey = await table.getAttribute("style");
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => table.getAttribute("style")).not.toBe(beforeKey);
  const beforeDrag = await table.getAttribute("style");
  const box = await table.boundingBox();
  if (!box) throw new Error("table has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => table.getAttribute("style")).not.toBe(beforeDrag);
  // Moving a table must not open its edit form.
  await expect(page.locator(".floor-editor")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Salón principal", exact: true })).toBeVisible();
  await expect(page.locator("[data-table]")).toHaveAttribute("aria-label", /Mesa 1, Ocupada/);
  await expect(page.locator("[data-table]")).not.toHaveAttribute("style", beforeKey!);

  // Second section can be created and organized without overlapping the first
  await page.getByRole("button", { name: "Editar plano", exact: true }).click();
  await page.getByRole("button", { name: "Sección", exact: true }).click();
  await expect(page.getByLabel("X de la sección")).toHaveCount(0);
  await expect(page.getByLabel("Ancho de la sección")).toHaveCount(0);
  await page.getByLabel("Nombre de la sección").fill("Terraza");
  await page.getByRole("button", { name: "Agregar sección", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Terraza", exact: true })).toBeVisible();
  const section = page.locator('[data-section]').filter({ has: page.getByRole("heading", { name: "Terraza", exact: true }) });
  await section.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Traer al frente" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar al fondo" })).toBeVisible();
  await page.getByRole("button", { name: "Traer al frente" }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  const beforeSection = await section.getAttribute("style");
  await page.getByRole("button", { name: "Mover Terraza" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => section.getAttribute("style")).not.toBe(beforeSection);

  // Owner-only controls are preserved; the waiter view is not part of this editor.
  await expect(page.getByRole("button", { name: "Tipos de mesa" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("floor-plan.png"), fullPage: true });
  expect(errors).toEqual([]);
});
