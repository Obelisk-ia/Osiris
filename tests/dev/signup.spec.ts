import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("owner and employee sign up directly into the dashboard and resume invalid-code attempts", async ({ page, browser, baseURL }) => {
  test.skip(process.env.OSIRIS_TEST_LIVE_SIGNUP !== "1", "Opt in: creates disposable accounts and a restaurant in the development backend.");
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const id = randomUUID();
  const password = `Cedar meadow! ${randomUUID()}`;
  const restaurant = `Signup test ${id}`;
  const ownerEmail = `signup-owner-${id}@example.invalid`;
  await page.goto("/crear-cuenta");
  await page.getByLabel("Tu nombre", { exact: true }).fill("Test owner");
  await page.getByLabel("Nombre del restaurante", { exact: true }).fill(restaurant);
  await expect(page.getByRole("combobox", { name: "Modalidad de servicio" })).toHaveValue("a_la_carte");
  await page.getByLabel("Correo", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page).toHaveURL(/\/cuenta\/mesas$/);
  await expect(page.getByRole("banner").getByText(restaurant)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pantallas de administración" })
    .getByRole("link", { name: "Buffet", exact: true })).toHaveCount(0);
  await expect(page.getByText("Completa tu registro", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Test owner/ }).click();
  const invitation = page.locator(".restaurant-code");
  await expect(invitation).toHaveText(/^OSR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const code = (await invitation.textContent())!;
  await page.reload();
  await expect(page.getByRole("banner").getByText(restaurant)).toBeVisible();
  await page.goto("/crear-cuenta");
  await expect(page).toHaveURL(/\/cuenta\/mesas$/);
  await page.getByRole("button", { name: /Test owner/ }).click();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/acceso$/);
  await page.getByLabel("Correo", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/cuenta\/mesas$/);
  await expect(page.getByRole("banner").getByText(restaurant)).toBeVisible();

  const staffContext = await browser.newContext({ baseURL });
  try {
    // Separate contexts keep the owner and employee sessions isolated.
    const staff = await staffContext.newPage();
    staff.on("pageerror", error => errors.push(error.message));
    await staff.goto("/crear-cuenta");
    await staff.getByRole("radio", { name: "Soy empleado", exact: false }).check();
    await staff.getByLabel("Tu nombre", { exact: true }).fill("Test employee");
    await staff.getByLabel("Código del restaurante", { exact: true }).fill("OSR-AAAA-BBBB-CCCC");
    await staff.getByRole("checkbox", { name: /Mesero/ }).check();
    await staff.getByRole("checkbox", { name: /Chef \(Cocina\)/ }).check();
    await staff.getByRole("checkbox", { name: /Caja/ }).check();
    await expect(staff.getByRole("checkbox")).toHaveCount(6);
    await staff.getByLabel("Correo", { exact: true }).fill(`signup-staff-${id}@example.invalid`);
    await staff.getByLabel("Contraseña", { exact: true }).fill(password);
    await staff.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(staff.getByRole("tabpanel", { name: "Crear cuenta" }).getByRole("alert")).toContainText("El código del restaurante no es válido");
    await expect(staff).toHaveURL(/\/crear-cuenta$/);
    await expect(staff.getByLabel("Tu nombre", { exact: true })).toHaveValue("Test employee");
    await expect(staff.getByRole("checkbox", { name: /Mesero/ })).toBeChecked();
    await expect(staff.getByRole("checkbox", { name: /Chef \(Cocina\)/ })).toBeChecked();
    await expect(staff.getByRole("checkbox", { name: /Caja/ })).toBeChecked();
    await expect(staff.getByLabel("Contraseña", { exact: true })).toHaveCount(0);
    // Reloading an interrupted registration resumes on signup, never on a
    // separate onboarding screen or a signup → dashboard → signup redirect loop.
    await staff.goto("/cuenta");
    await expect(staff).toHaveURL(/\/crear-cuenta$/);
    await expect(staff.getByLabel("Correo", { exact: true })).toHaveCount(0);
    await staff.getByRole("radio", { name: "Soy empleado", exact: false }).check();
    await staff.getByLabel("Tu nombre", { exact: true }).fill("Test employee");
    await staff.getByLabel("Código del restaurante", { exact: true }).fill(code);
    await staff.getByRole("checkbox", { name: /Mesero/ }).check();
    await staff.getByRole("checkbox", { name: /Chef \(Cocina\)/ }).check();
    await staff.getByRole("checkbox", { name: /Caja/ }).check();
    await staff.getByRole("button", { name: "Guardar y entrar al panel", exact: true }).click();
    await expect(staff).toHaveURL(/\/cuenta\/mesas$/);
    await expect(staff.getByRole("banner").getByText(restaurant)).toBeVisible();
    await staff.reload();
    await expect(staff.getByRole("banner").getByText(restaurant)).toBeVisible();
    await staff.getByRole("button", { name: /Test employee/ }).click();
    await staff.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await expect(staff).toHaveURL(/\/acceso$/);
  } finally {
    // Sign-out is already asserted above for both accounts. Closing the
    // contexts is sufficient cleanup and avoids a second in-flight sign-out.
    await staffContext.close();
  }
  expect(errors).toEqual([]);
});
