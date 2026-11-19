import { expect, test } from "@playwright/test";

test("development navigation and reloads do not emit module, hook, or instant-UI errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || (
      message.type() === "warning" &&
      /HMR|module factory|hook call|scroll-behavior/i.test(message.text())
    )) {
      errors.push(message.text());
    }
  });
  // These errors are development-only; the production smoke suite cannot catch them.
  for (let pass = 0; pass < 2; pass++) {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu restaurante, en orden.");
    await page.getByRole("link", { name: "Entrar a Osiris" }).click();
    await expect(page).toHaveURL(/\/acceso$/);
    await page.getByRole("tab", { name: "Crear cuenta" }).click();
    await expect(page).toHaveURL(/\/crear-cuenta$/);
    await page.getByRole("tab", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/acceso$/);
    await expect(page.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bienvenido de vuelta.");
  }
  expect(errors).toEqual([]);
});
