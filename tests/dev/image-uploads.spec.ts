import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const menuPath = "/cuenta/administracion/menu";
const maxDimension = 1200;

test.use({ actionTimeout: 10_000 });

async function makeJpeg(page: Page, width: number, quality: number) {
  // Use a checked-in asset so the test can run without downloading a fixture.
  const bytes = await page.evaluate(async ({ width, quality }) => {
    const response = await fetch("/collage/landing.webp");
    if (!response.ok) throw new Error("Could not load the test image source");
    const source = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round(source.height * width / source.width);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode test JPEG")), "image/jpeg", quality);
    });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { width, quality });
  return { name: "fixture.jpg", mimeType: "image/jpeg", buffer: Buffer.from(bytes) };
}

async function imageDimensions(image: Locator) {
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  return image.evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight }));
}

async function expectStoredWebp(request: APIRequestContext, image: Locator, original: { width: number; height: number; bytes: number }) {
  await expect(image).toHaveAttribute("src", /^https?:\/\//);
  const scale = Math.min(1, maxDimension / Math.max(original.width, original.height));
  const dimensions = await imageDimensions(image);
  expect(dimensions).toEqual({
    width: Math.round(original.width * scale),
    height: Math.round(original.height * scale),
  });
  const response = await request.get((await image.getAttribute("src"))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/^image\/webp\b/);
  const bytes = await response.body();
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  if (scale < 1) expect(bytes.length).toBeLessThan(original.bytes);
  return { ...dimensions, bytes: bytes.length };
}

test("dish and background uploads reach the public menu as optimized WebP images", async ({ page: owner, browser, request, baseURL }, testInfo) => {
  test.skip(process.env.OSIRIS_TEST_LIVE_SIGNUP !== "1", "Opt in: creates a disposable account and restaurant in the development backend.");
  test.setTimeout(90_000);
  const id = randomUUID();
  const dishName = "Pizza de prueba";
  await owner.goto("/crear-cuenta");
  await owner.getByLabel("Tu nombre", { exact: true }).fill("Prueba de imágenes");
  await owner.getByLabel("Nombre del restaurante", { exact: true }).fill(`Prueba de imágenes ${id.slice(0, 8)}`);
  await owner.getByLabel("Correo", { exact: true }).fill(`image-test-${id}@example.invalid`);
  await owner.getByLabel("Contraseña", { exact: true }).fill(`Cedar meadow! ${randomUUID()}`);
  await owner.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(owner).toHaveURL(/\/cuenta\/mesas$/);

  const fixturePath = process.env.OSIRIS_TEST_IMAGE_JPEG;
  const jpeg = fixturePath
    ? { name: "fixture.jpg", mimeType: "image/jpeg", buffer: await readFile(fixturePath) }
    : await makeJpeg(owner, 2100, 0.98);

  await owner.goto("/cuenta/administracion/codigos-qr");
  const publicMenu = owner.getByRole("link", { name: "Abrir carta", exact: true });
  await expect(publicMenu).toHaveAttribute("href", /\/menu\//);
  const publicPath = (await publicMenu.getAttribute("href"))!;
  await owner.goto(menuPath);
  const guestContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guest = await guestContext.newPage();
  try {
    await owner.getByRole("button", { name: "Nuevo producto" }).click();
    const dish = owner.getByRole("dialog");
    await dish.getByLabel("Título del platillo").fill(dishName);
    await dish.getByLabel("Precio (MXN)").fill("160.00");
    await dish.getByLabel("Foto del platillo (opcional)").setInputFiles(jpeg);
    const dishPreview = dish.getByAltText("Vista previa del platillo");
    await expect(dishPreview).toHaveAttribute("src", /^blob:/);
    const original = { ...(await imageDimensions(dishPreview)), bytes: jpeg.buffer.length };
    expect(Math.max(original.width, original.height)).toBeGreaterThan(maxDimension);
    await dish.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(dish).toHaveCount(0);

    await owner.getByRole("tab", { name: "Apariencia" }).click();
    await owner.getByRole("radio", { name: "Foto", exact: true }).check();
    await owner.getByLabel("Elegir foto del fondo").setInputFiles(jpeg);
    await expect(owner.locator("figure [data-menu-background='photo'] img")).toHaveAttribute("src", /^blob:/);
    await owner.getByRole("button", { name: "Guardar fondo" }).click();
    await expect(owner.getByText("Fondo del menú actualizado")).toBeVisible();

    await guest.goto(publicPath);
    const dishPhoto = guest.getByRole("img", { name: dishName, exact: true });
    await dishPhoto.scrollIntoViewIfNeeded();
    const storedDish = await expectStoredWebp(request, dishPhoto, original);
    const storedBackground = await expectStoredWebp(request, guest.locator("[data-menu-background='photo'] img"), original);
    const screenshot = testInfo.outputPath("mobile-menu.png");
    await guest.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("mobile-menu", { path: screenshot, contentType: "image/png" });

    // A tiny, heavily compressed JPEG still needs converting even if WebP is larger.
    const smallJpeg = await makeJpeg(owner, 320, 0.1);
    await owner.getByRole("tab", { name: /^Productos/ }).click();
    await owner.getByRole("button", { name: `Editar ${dishName}` }).click();
    await dish.getByLabel("Foto del platillo (opcional)").setInputFiles(smallJpeg);
    await expect(dishPreview).toHaveAttribute("src", /^blob:/);
    const smallOriginal = { ...(await imageDimensions(dishPreview)), bytes: smallJpeg.buffer.length };
    expect(smallOriginal.width).toBe(320);
    await dish.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(dish).toHaveCount(0);
    await guest.reload();
    await dishPhoto.scrollIntoViewIfNeeded();
    const storedSmallDish = await expectStoredWebp(request, dishPhoto, smallOriginal);
    const metrics = testInfo.outputPath("image-sizes.json");
    await writeFile(metrics, JSON.stringify({ original, dish: storedDish, background: storedBackground, smallOriginal, smallDish: storedSmallDish }, null, 2));
    await testInfo.attach("image-sizes", { path: metrics, contentType: "application/json" });

    // Remove the test images via the same UI the owner uses.
    await owner.getByRole("button", { name: `Borrar ${dishName}` }).click();
    await owner.getByRole("dialog", { name: `Borrar ${dishName}` })
      .getByRole("button", { name: "Borrar", exact: true }).click();
    await expect(dishPhoto).toHaveCount(0);
    await owner.getByRole("tab", { name: "Apariencia" }).click();
    await owner.getByRole("radio", { name: "Fondo de Osiris" }).check();
    await owner.getByRole("button", { name: "Guardar fondo" }).click();
    await expect(guest.locator("[data-menu-background]")).toHaveAttribute("data-menu-background", "default");
  } finally {
    await guestContext.close();
  }
});
