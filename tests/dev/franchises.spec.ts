import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("multi-franchise flow: owner switcher & status, dropdown signup, manager permissions, per-branch sold-out, and staff transfer", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.OSIRIS_TEST_LIVE_SIGNUP !== "1",
    "Opt in: creates disposable accounts and franchises in the development backend.",
  );
  test.setTimeout(150_000);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const id = randomUUID().slice(0, 8);
  const password = `Cedar meadow! ${randomUUID()}`;
  const restaurant = `Franquicia ${id}`;
  const branch2Name = `Sucursal Roma ${id}`;
  const ownerEmail = `franchise-owner-${id}@example.invalid`;
  const romaWaiterEmail = `franchise-roma-${id}@example.invalid`;
  const managerEmail = `franchise-mgr-${id}@example.invalid`;

  // 1. Owner signs up
  await page.goto("/crear-cuenta");
  await page.getByLabel("Tu nombre", { exact: true }).fill("Mariana Dueña");
  await page.getByLabel("Nombre del restaurante", { exact: true }).fill(restaurant);
  await page.getByLabel("Correo", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/cuenta\/mesas$/);
  await expect(page.getByRole("banner").getByText(restaurant)).toBeVisible();

  // Copy restaurant invite code
  await page.getByRole("button", { name: /Mariana Dueña/ }).click();
  const codeEl = page.locator(".restaurant-code");
  await expect(codeEl).toHaveText(/^OSR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const code = (await codeEl.textContent())!;
  await page.keyboard.press("Escape");

  // 2. Owner creates a second franchise and sees live status badges
  await page.getByRole("link", { name: /Sucursales/ }).click();
  await expect(page).toHaveURL(/\/cuenta\/administracion\/sucursales$/);
  await page.getByRole("button", { name: "Agregar sucursal" }).click();
  await page.getByLabel("Nombre de la sucursal", { exact: true }).fill(branch2Name);
  await page.getByLabel("Dirección (opcional)", { exact: true }).fill("Calle Colima 80");
  await page.getByRole("dialog").getByRole("button", { name: "Agregar sucursal" }).click();
  await expect(page.getByRole("list").getByText(branch2Name, { exact: true })).toBeVisible();
  await expect(page.getByText("Caja cerrada").first()).toBeVisible();

  // 3. Owner top-bar switcher switches to Branch 2 and back
  const topSwitcher = page.getByRole("combobox", { name: "Cambiar de sucursal" });
  await expect(topSwitcher).toBeVisible();
  await topSwitcher.selectOption({ label: branch2Name });
  await expect(page.getByRole("banner").getByText(`${restaurant} · ${branch2Name}`)).toBeVisible();
  await topSwitcher.selectOption({ label: restaurant });
  await expect(page.getByRole("banner").getByText(`${restaurant} · ${restaurant}`)).toBeVisible();

  // 4. Owner creates a shared dish
  await page.getByRole("link", { name: /Menú/ }).click();
  await expect(page).toHaveURL(/\/cuenta\/administracion\/menu$/);
  await page.getByRole("button", { name: /Nuevo producto|Agregar primer platillo/ }).first().click();
  const dishDialog = page.getByRole("dialog");
  await dishDialog.getByLabel("Título del platillo").fill("Tacos al Pastor");
  await dishDialog.getByLabel(/Precio/i).fill("120");
  await dishDialog.getByRole("button", { name: /Guardar|Crear/i }).click();
  await expect(page.getByText("Tacos al Pastor")).toBeVisible();

  const romaContext = await browser.newContext({ baseURL });
  const mgrContext = await browser.newContext({ baseURL });
  try {
    // 5. Employee 1 signs up directly into Branch 2 via dropdown
    const romaPage = await romaContext.newPage();
    romaPage.on("pageerror", (error) => errors.push(error.message));
    await romaPage.goto("/crear-cuenta");
    await romaPage.getByRole("radio", { name: "Soy empleado", exact: false }).check();
    await romaPage.getByLabel("Tu nombre", { exact: true }).fill("Sofía Roma");
    await romaPage.getByLabel("Código del restaurante", { exact: true }).fill(code);
    const branchSelect = romaPage.getByLabel("Sucursal o establecimiento", { exact: true });
    await expect(branchSelect).toBeVisible({ timeout: 15_000 });
    await branchSelect.selectOption({ label: `${branch2Name} — Calle Colima 80` });
    await romaPage.getByRole("checkbox", { name: /Mesero/ }).check();
    await romaPage.getByLabel("Correo", { exact: true }).fill(romaWaiterEmail);
    await romaPage.getByLabel("Contraseña", { exact: true }).fill(password);
    await romaPage.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(romaPage).toHaveURL(/\/cuenta\/mesas$/);
    await expect(romaPage.getByRole("banner").getByText(branch2Name)).toBeVisible();

    // 6. Employee 2 signs up into Branch 1 via dropdown
    const mgrPage = await mgrContext.newPage();
    mgrPage.on("pageerror", (error) => errors.push(error.message));
    await mgrPage.goto("/crear-cuenta");
    await mgrPage.getByRole("radio", { name: "Soy empleado", exact: false }).check();
    await mgrPage.getByLabel("Tu nombre", { exact: true }).fill("Carlos Gerente");
    await mgrPage.getByLabel("Código del restaurante", { exact: true }).fill(code);
    const mgrBranchSelect = mgrPage.getByLabel("Sucursal o establecimiento", { exact: true });
    await expect(mgrBranchSelect).toBeVisible({ timeout: 15_000 });
    await mgrBranchSelect.selectOption({ label: restaurant });
    await mgrPage.getByRole("checkbox", { name: /Mesero/ }).check();
    await mgrPage.getByLabel("Correo", { exact: true }).fill(managerEmail);
    await mgrPage.getByLabel("Contraseña", { exact: true }).fill(password);
    await mgrPage.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(mgrPage).toHaveURL(/\/cuenta\/mesas$/);
    await expect(mgrPage.getByRole("banner").getByText(`${restaurant} · ${restaurant}`)).toBeVisible();

    // 7. Owner promotes Carlos to plain Manager (no special permissions yet)
    await page.getByRole("link", { name: /Miembros/ }).click();
    await expect(page).toHaveURL(/\/cuenta\/administracion\/miembros$/);
    await expect(page.getByText("Carlos Gerente")).toBeVisible();
    await expect(page.getByText("Sofía Roma")).toHaveCount(0);

    const carlosRow = page.locator("li", { hasText: "Carlos Gerente" });
    await carlosRow.getByRole("button", { name: "Roles" }).click();
    await page.getByRole("dialog").getByLabel(/Gerente/).check();
    await expect(page.getByRole("dialog").getByText("Editar menú compartido")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Cambiar personal de sucursal")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Guardar roles" }).click();
    await expect(carlosRow.getByText("Gerente", { exact: true })).toBeVisible();

    // 8. Carlos (plain manager) cannot access Sucursales, cannot edit shared menu,
    //    but CAN mark Tacos al Pastor sold out locally in Branch 1
    await mgrPage.reload();
    await expect(
      mgrPage.getByRole("navigation", { name: "Pantallas de administración" }).getByRole("link", { name: /Sucursales/ }),
    ).toHaveCount(0);
    await mgrPage.goto("/cuenta/administracion/sucursales");
    await expect(mgrPage).toHaveURL(/\/cuenta\/mesas$/);

    await mgrPage.getByRole("link", { name: /Menú/ }).click();
    await expect(mgrPage).toHaveURL(/\/cuenta\/administracion\/menu$/);
    await expect(mgrPage.getByText("El catálogo del menú es compartido entre sucursales")).toBeVisible();
    await expect(mgrPage.getByRole("button", { name: "Nuevo producto" })).toHaveCount(0);
    await expect(mgrPage.getByRole("tab", { name: "Apariencia" })).toHaveCount(0);

    const tacosRowMgr = mgrPage.locator("li", { hasText: "Tacos al Pastor" });
    await tacosRowMgr.getByRole("button", { name: "Agotado", exact: true }).click();
    await expect(tacosRowMgr.getByRole("button", { name: "Disponible", exact: true })).toBeVisible();

    // 9. Owner switches to Branch 2 and confirms Tacos al Pastor is STILL available there
    await topSwitcher.selectOption({ label: branch2Name });
    await page.getByRole("link", { name: /Menú/ }).click();
    const tacosRowBranch2 = page.locator("li", { hasText: "Tacos al Pastor" });
    await expect(tacosRowBranch2.getByRole("button", { name: "Agotado", exact: true })).toBeVisible();

    // 10. Owner switches back to Branch 1, grants Carlos edit_menu + transfer_staff
    await topSwitcher.selectOption({ label: restaurant });
    await page.getByRole("link", { name: /Miembros/ }).click();
    const carlosRow2 = page.locator("li", { hasText: "Carlos Gerente" });
    await carlosRow2.getByRole("button", { name: "Roles" }).click();
    await page.getByRole("dialog").getByLabel(/Editar menú compartido/).check();
    await page.getByRole("dialog").getByLabel(/Cambiar personal de sucursal/).check();
    await page.getByRole("dialog").getByRole("button", { name: "Guardar roles" }).click();
    await expect(carlosRow2.getByText("Edita menú")).toBeVisible();
    await expect(carlosRow2.getByText("Cambia sucursales")).toBeVisible();

    // Carlos now sees Nuevo producto & Apariencia tab on Menú
    await expect(mgrPage.getByRole("button", { name: "Nuevo producto" })).toBeVisible();
    await expect(mgrPage.getByRole("tab", { name: "Apariencia" })).toBeVisible();

    // 11. Owner transfers Carlos to Branch 2 via the Sucursal modal
    await carlosRow2.getByRole("button", { name: "Sucursal" }).click();
    await page.getByRole("dialog").getByLabel("Sucursal de destino").selectOption({ label: branch2Name });
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar cambio" }).click();
    await expect(page.getByText("Carlos Gerente")).toHaveCount(0);

    // Carlos's header updates to Branch 2
    await expect(mgrPage.getByRole("banner").getByText(`${restaurant} · ${branch2Name}`)).toBeVisible();

    // 12. Owner checks Sucursales live status: Branch 2 now shows 2 empleados (Sofía + Carlos)
    await page.getByRole("link", { name: /Sucursales/ }).click();
    const branch2Row = page.locator("li", { hasText: branch2Name });
    await expect(branch2Row.getByText("2 empleados")).toBeVisible();
  } finally {
    await romaContext.close();
    await mgrContext.close();
  }

  expect(errors).toEqual([]);
});
