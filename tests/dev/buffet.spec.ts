import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ actionTimeout: 10_000 });

test("salón, cocina y caja operan una sucursal de buffet", async ({ page: owner, browser, baseURL }, testInfo) => {
  test.skip(process.env.OSIRIS_TEST_LIVE_SIGNUP !== "1", "Creates disposable accounts in the development backend.");
  test.setTimeout(120_000);
  const id = randomUUID();
  const password = `Cedar meadow! ${randomUUID()}`;
  const dishName = "Pollo asado";
  const menuName = "Buffet de prueba";

  async function signUp(page: Page, role: "owner" | "waiter" | "chef", code?: string) {
    await page.goto("/crear-cuenta");
    if (code) {
      await page.getByRole("radio", { name: "Soy empleado", exact: false }).check();
      await page.getByLabel("Código del restaurante", { exact: true }).fill(code);
      await page.getByRole("checkbox", { name: role === "waiter" ? /Mesero/ : /Chef \(Cocina\)/ }).check();
    } else {
      await page.getByLabel("Nombre del restaurante", { exact: true }).fill(`Playtest Buffet ${id.slice(0, 8)}`);
      await page.getByLabel("Modalidad de servicio", { exact: true }).selectOption("mixed");
    }
    await page.getByLabel("Tu nombre", { exact: true }).fill(`Prueba ${role}`);
    await page.getByLabel("Correo", { exact: true }).fill(`buffet-${role}-${id}@example.invalid`);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await expect(page).toHaveURL(role === "chef" ? /\/cuenta\/cocina$/ : /\/cuenta\/mesas$/);
  }

  await signUp(owner, "owner");
  await owner.getByRole("button", { name: /Prueba owner/ }).click();
  const invitation = owner.locator(".restaurant-code");
  await expect(invitation).toHaveText(/^OSR-/);
  const code = (await invitation.innerText()).trim();

  await owner.goto("/cuenta/administracion/menu");
  await owner.getByRole("button", { name: "Nuevo producto" }).click();
  await owner.getByLabel("Título del platillo").fill(dishName);
  await owner.getByLabel("Precio (MXN)").fill("160.00");
  await owner.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);

  await owner.goto("/cuenta/administracion/buffet");
  await owner.getByRole("button", { name: "Nuevo menú de buffet" }).click();
  await owner.getByLabel("Nombre", { exact: true }).fill(menuName);
  await owner.getByRole("checkbox", { name: /Pollo asado/ }).check();
  await owner.getByLabel("Estación del buffet").fill("Línea caliente");
  await owner.getByLabel("Porciones por bandeja").fill("8");
  await owner.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByText(menuName, { exact: true })).toBeVisible();

  const waiterContext = await browser.newContext({
    baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const chefContext = await browser.newContext({ baseURL });
  try {
    const waiter = await waiterContext.newPage();
    const chef = await chefContext.newPage();
    await signUp(waiter, "waiter", code);
    await signUp(chef, "chef", code);

    await waiter.getByRole("navigation", { name: "Navegación principal móvil" })
      .getByRole("link", { name: "Buffet", exact: true }).click();
    await expect(waiter.getByRole("heading", { name: "Servicio de buffet" })).toBeVisible();
    const menu = waiter.getByRole("region", { name: menuName });
    await expect(menu.getByText("8 porciones por bandeja · Cocina")).toBeVisible();
    await menu.getByRole("button", { name: "Pedir reposición" }).click();

    const inProgress = waiter.getByRole("region", { name: "Reposiciones en curso" });
    await expect(inProgress.getByText("Solicitada", { exact: true })).toBeVisible();
    await expect(menu.getByText("Reposición en curso", { exact: true })).toBeVisible();
    const ticket = chef.getByRole("article", { name: `Reposición de ${dishName}` });
    await expect(chef.getByRole("region", { name: "Nuevos" }).getByRole("article")).toHaveCount(1);
    await expect(ticket).toContainText("Línea caliente");
    await expect(ticket).toContainText("1 bandeja · 8 porciones");
    await chef.screenshot({ path: testInfo.outputPath("cocina-reposicion.png") });
    await ticket.getByRole("button", { name: "Empezar a preparar" }).click();
    await expect(inProgress.getByText("En preparación", { exact: true })).toBeVisible();

    await ticket.getByRole("button", { name: "Lista para llevar", exact: true }).click();
    await expect(inProgress.getByText("Lista para llevar", { exact: true })).toBeVisible();
    await waiter.screenshot({ path: testInfo.outputPath("salon-bandeja-lista.png") });
    await waiter.getByRole("button", { name: /Avisos, 1 sin leer/ }).click();
    const mobileNotices = waiter.getByRole("dialog", { name: /Avisos/ });
    await expect(mobileNotices.getByRole("heading", { name: /Avisos/ })).toBeInViewport();
    await expect(mobileNotices.getByText("Buffet: Pollo asado listo para llevar", { exact: true })).toBeVisible();
    await mobileNotices.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(mobileNotices).toHaveCount(0);

    const desktopContext = await browser.newContext({ baseURL, storageState: await waiterContext.storageState() });
    try {
      const desktop = await desktopContext.newPage();
      await desktop.goto("/cuenta/mesas");
      await desktop.getByRole("button", { name: /Avisos, 1 sin leer/ }).click();
      const notices = desktop.getByRole("dialog", { name: /Avisos/ });
      await expect(notices.getByRole("heading", { name: /Avisos/ })).toBeInViewport();
      await expect(notices.getByRole("button", { name: "Cerrar", exact: true })).toBeInViewport();
      await notices.getByRole("button", { name: "Ver reposición" }).click();
      await expect(desktop).toHaveURL(/\/cuenta\/buffet$/);
      await expect(desktop.getByRole("dialog", { name: /Avisos/ })).toHaveCount(0);
      await expect(waiter.getByRole("banner").getByRole("button", { name: "Avisos", exact: true })).toBeVisible();
    } finally {
      await desktopContext.close();
    }
    await inProgress.getByRole("button", { name: "Marcar repuesta" }).click();

    await expect(ticket).toHaveCount(0);
    await expect(inProgress).toHaveCount(0);
    await waiter.getByText("Reposiciones recientes", { exact: true }).click();
    await expect(waiter.getByText(/^Repuesta en /)).toBeVisible();

    await menu.getByRole("button", { name: "Pedir reposición" }).click();
    await expect(ticket).toBeVisible();
    await owner.goto("/cuenta/administracion/caracteristicas");
    const mode = owner.getByRole("combobox", { name: "Modalidad de servicio" });
    const adminBuffet = owner.getByRole("navigation", { name: "Pantallas de administración" })
      .getByRole("link", { name: "Buffet" });
    const mobileBuffet = waiter.getByRole("navigation", { name: "Navegación principal móvil" })
      .getByRole("link", { name: "Buffet", exact: true });
    await mode.selectOption("a_la_carte");
    await expect(waiter.getByText("Buffet desactivado", { exact: true })).toBeVisible();
    await expect(mobileBuffet).toBeVisible();
    await expect(adminBuffet).toHaveAttribute("href", "/cuenta/buffet");

    await ticket.getByRole("button", { name: "Ya está lista" }).click();
    await expect(inProgress.getByText("Lista para llevar", { exact: true })).toBeVisible();
    await inProgress.getByRole("button", { name: "Marcar repuesta" }).click();
    await expect(ticket).toHaveCount(0);
    await expect(mobileBuffet).toHaveCount(0);
    await expect(adminBuffet).toHaveCount(0);
    await waiter.goto("/cuenta/buffet");
    await expect(waiter).toHaveURL(/\/cuenta\/mesas$/);

    await mode.selectOption("buffet");
    await expect(adminBuffet).toHaveAttribute("href", "/cuenta/administracion/buffet");
    await waiter.goto("/cuenta");
    await expect(waiter).toHaveURL(/\/cuenta\/buffet$/);
    await expect(menu.getByRole("button", { name: "Pedir reposición" })).toBeEnabled();

    const assignedTables = owner.getByRole("checkbox", { name: "Asignar mesas en el buffet" });
    await expect(assignedTables).toBeChecked();
    await owner.getByLabel("Tarifa de adulto (MXN)").fill("200.00");
    await owner.getByLabel("Tarifa de niño (MXN)").fill("90.00");
    await owner.getByRole("button", { name: "Guardar tarifas" }).click();
    await expect(owner.getByText("Tarifas de buffet guardadas")).toBeVisible();
    await owner.goto("/cuenta/mesas");
    await owner.getByRole("button", { name: "Agregar la primera sección" }).click();
    await owner.getByLabel("Nombre de la sección").fill("Comedor del buffet");
    await owner.getByRole("button", { name: "Agregar sección", exact: true }).click();
    await owner.getByRole("button", { name: "Mesa", exact: true }).click();
    await owner.getByLabel("Nombre de la mesa").fill("Mesa 1");
    await owner.getByRole("button", { name: "Agregar mesa", exact: true }).click();
    await owner.getByRole("button", { name: "Terminar", exact: true }).click();
    const table = owner.getByRole("button", { name: /Mesa 1, (Libre|Ocupada|Quieren pagar)/ });
    await expect(table).toHaveAccessibleName(/Mesa 1, Libre/);
    await waiter.goto("/cuenta/mesas");
    await waiter.getByRole("link", { name: /Mesa 1.*Sentar grupo/ }).click();
    await expect(waiter.getByRole("heading", { name: "Sentar grupo" })).toBeVisible();
    await waiter.getByLabel("Adultos", { exact: true }).fill("2");
    await waiter.getByLabel("Niños", { exact: true }).fill("1");
    await waiter.getByRole("button", { name: "Confirmar grupo" }).click();
    await expect(waiter.getByRole("region", { name: "Entrada del buffet" })).toContainText("2 × Adulto");
    await expect(waiter.getByRole("button", { name: "Agregar extras" })).toHaveCount(0);
    await expect(table).toHaveAccessibleName(/Mesa 1, Ocupada/);
    await waiter.getByRole("button", { name: "Pedir la cuenta", exact: true }).click();
    await expect(table).toHaveAccessibleName(/Mesa 1, Quieren pagar/);

    await owner.goto("/cuenta/caja");
    const payable = owner.getByRole("region", { name: "Cuentas listas para cobrar" });
    await expect(payable.getByText("490.00", { exact: false }).first()).toBeVisible();
    await payable.getByRole("button", { name: /^Cobrar .*490\.00/ }).click();
    const charge = owner.getByRole("dialog", { name: /Cobrar/ });
    await charge.getByLabel("Monto recibido").fill("490.00");
    await charge.getByRole("button", { name: "Confirmar cobro" }).click();
    await expect(owner.getByRole("dialog", { name: "Cuenta cobrada y cerrada" })).toBeVisible();
    await owner.goto("/cuenta/mesas");
    await expect(table).toHaveAccessibleName(/Mesa 1, Libre/);

    await owner.goto("/cuenta/administracion/caracteristicas");
    await assignedTables.uncheck();
    await expect(assignedTables).toBeEnabled();
    await expect(owner.getByLabel("Tarifa de adulto (MXN)")).toHaveCount(0);
    await waiter.goto("/cuenta/mesas");
    await expect(waiter).toHaveURL(/\/cuenta\/buffet$/);

    await owner.goto("/cuenta/administracion/menu");
    await owner.getByRole("button", { name: "Nuevo producto" }).click();
    await owner.getByLabel("Título del platillo").fill("Limonada");
    await owner.getByLabel("Precio (MXN)").fill("45.00");
    await owner.getByRole("checkbox", { name: "Vender como extra en modo Solo buffet" }).check();
    await owner.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await owner.goto("/cuenta/administracion/codigos-qr");
    const publicMenu = owner.getByRole("link", { name: "Abrir carta", exact: true });
    await expect(publicMenu).toHaveAttribute("href", /\/menu\//);
    await owner.goto((await publicMenu.getAttribute("href"))!);
    await expect(owner.getByRole("heading", { name: /Extras del buffet/ })).toBeVisible();
    await expect(owner.getByText("Limonada", { exact: true })).toBeVisible();
    await expect(owner.getByText(dishName, { exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([waiterContext.close(), chefContext.close()]);
  }
});
