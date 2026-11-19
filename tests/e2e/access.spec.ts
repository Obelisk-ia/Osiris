import { expect, test } from "@playwright/test";

test("landing retains the design chapters and works without overflow", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu restaurante, en orden.");
  await expect(page.getByRole("navigation", { name: "Índice" }).getByRole("link")).toHaveCount(5);
  for (const id of ["mesas", "cocina", "caja", "reportes", "comensal", "metodo"]) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  const image = page.locator('img[alt*="Osiris en su trono"]');
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
  expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Scroll through the page to exercise each lazy-loaded reference collage.
  for (const collage of await page.locator("main img").all()) {
    await collage.scrollIntoViewIfNeeded();
    await expect.poll(() => collage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
  await page.getByRole("link", { name: "Entrar a Osiris" }).click();
  await expect(page).toHaveURL(/\/acceso$/);
  expect(errors).toEqual([]);
});

test("auth tabs and password visibility work without email recovery", async ({ page }, testInfo) => {
  await page.goto("/acceso");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bienvenido de vuelta.");
  await page.getByLabel("Correo", { exact: true }).fill("test@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("An example password! 392");
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await page.screenshot({ path: testInfo.outputPath("signin.png"), fullPage: true });
  await page.getByRole("tab", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/crear-cuenta$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Crea tu cuenta.");
  await expect(page.getByRole("tabpanel", { name: "Crear cuenta" }).getByLabel("Contraseña", { exact: true })).toHaveAttribute("minlength", "10");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("tab", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveCount(0);
});

test("account is protected and obsolete email routes are not exposed", async ({ page }) => {
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/acceso$/);
  for (const workspace of ["administracion", "mesas", "cocina", "caja", "buffet"]) {
    await page.goto(`/cuenta/${workspace}`);
    await expect(page).toHaveURL(/\/acceso$/);
  }
  for (const route of ["/validate-email", "/reset-password", "/recuperar"]) {
    expect((await page.goto(route))?.status()).toBe(404);
  }
});

test("SSR sign-in handler rejects unlisted functions and cross-site posts", async ({ request }) => {
  const payload = { path: "users:createUser", format: "convex_encoded_json", args: [{}] };
  const unlisted = await request.post("/auth/signin?path=/api/mutation", {
    headers: { Origin: "http://localhost:3100" }, data: payload,
  });
  expect(unlisted.status()).toBe(403);
  const crossSite = await request.post("/auth/signin?path=/api/mutation", {
    headers: { Origin: "https://not-osiris.example" }, data: payload,
  });
  expect(crossSite.status()).toBe(403);
});

test("sign-up is enabled without a mail sender or verification step", async ({ page }) => {
  await page.goto("/crear-cuenta");
  const submit = page.getByRole("button", { name: "Crear cuenta", exact: true });
  await expect(submit).toBeEnabled();
  await expect(page.getByText("Los correos de acceso aún no están habilitados", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sin correos de verificación.", { exact: false })).toBeVisible();
});

test("signup includes owner and employee details with multiple roles in one form", async ({ page }, testInfo) => {
  await page.goto("/crear-cuenta");
  await expect(page.getByRole("radio", { name: "Soy dueño", exact: false })).toBeChecked();
  await expect(page.getByLabel("Tu nombre", { exact: true })).toBeVisible();
  await page.getByLabel("Tu nombre", { exact: true }).fill("Mariana");
  await page.getByLabel("Nombre del restaurante", { exact: true }).fill("Casa Jacaranda");
  await page.getByRole("radio", { name: "Soy empleado", exact: false }).check();
  await expect(page.getByLabel("Nombre del restaurante", { exact: true })).toHaveCount(0);
  await page.getByLabel("Código del restaurante", { exact: true }).fill("OSR-AAAA-BBBB-CCCC");
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: /Chef, bartender y barista/ })).toHaveCount(1);
  await page.getByRole("checkbox", { name: /Mesero/ }).check();
  await page.getByRole("checkbox", { name: /Cocina y barra/ }).check();
  await page.getByRole("checkbox", { name: /Caja/ }).check();
  await expect(page.getByRole("checkbox", { name: /Mesero/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Cocina y barra/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Caja/ })).toBeChecked();
  await page.getByRole("radio", { name: "Soy dueño", exact: false }).check();
  await expect(page.getByLabel("Nombre del restaurante", { exact: true })).toHaveValue("Casa Jacaranda");
  await expect(page.getByLabel("Tu nombre", { exact: true })).toHaveValue("Mariana");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("signup-owner.png"), fullPage: true });
  await page.getByRole("radio", { name: "Soy empleado", exact: false }).check();
  await expect(page.getByRole("checkbox", { name: /Mesero/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Cocina y barra/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Caja/ })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("signup-employee.png"), fullPage: true });
});

test("employee role validation stays on signup without creating an account", async ({ page }) => {
  const signupRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/auth/signin")) signupRequests.push(request.url());
  });
  await page.goto("/crear-cuenta");
  await page.getByRole("radio", { name: "Soy empleado", exact: false }).check();
  await page.getByLabel("Tu nombre", { exact: true }).fill("Mariana");
  await page.getByLabel("Código del restaurante", { exact: true }).fill("OSR-AAAA-BBBB-CCCC");
  await page.getByLabel("Correo", { exact: true }).fill("validation@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Desert lanterns! Copper river 829");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Crear cuenta" }).getByRole("alert")).toContainText("Elige al menos un rol");
  await expect(page).toHaveURL(/\/crear-cuenta$/);
  await expect(page.getByLabel("Tu nombre", { exact: true })).toHaveValue("Mariana");
  expect(signupRequests).toEqual([]);
});
