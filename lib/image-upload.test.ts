import { describe, expect, it } from "vitest";
import {
  compressImageForUpload,
  fitWithinMaxDimension,
  resolveImageOptions,
  validateImageFile,
} from "./image-upload";

// The edge-runtime VM may not expose File; a minimal Blob subclass covers the pure logic.
if (typeof File === "undefined") {
  globalThis.File = class File extends Blob {
    readonly name: string;
    readonly lastModified: number;
    constructor(bits: BlobPart[], name: string, options?: { type?: string }) {
      super(bits, options);
      this.name = name;
      this.lastModified = Date.now();
    }
  } as typeof File;
}

function makeImageFile(size: number, type = "image/png", name = "foto.png"): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe("fitWithinMaxDimension", () => {
  it("never upscales images already inside the cap", () => {
    expect(fitWithinMaxDimension(800, 600, 1200)).toEqual({ width: 800, height: 600, resized: false });
  });

  it("scales the longest edge down to the cap, preserving aspect ratio", () => {
    expect(fitWithinMaxDimension(3000, 2000, 1200)).toEqual({ width: 1200, height: 800, resized: true });
    expect(fitWithinMaxDimension(1500, 3000, 1200)).toEqual({ width: 600, height: 1200, resized: true });
  });

  it("leaves degenerate dimensions untouched", () => {
    expect(fitWithinMaxDimension(0, 0, 1200)).toEqual({ width: 0, height: 0, resized: false });
  });
});

describe("validateImageFile", () => {
  it("accepts allowed image types under the preset input cap", () => {
    expect(validateImageFile(makeImageFile(1024))).toBeNull();
    expect(validateImageFile(makeImageFile(1024, "image/jpeg", "foto.jpg"))).toBeNull();
    expect(validateImageFile(makeImageFile(1024, "image/webp", "foto.webp"))).toBeNull();
    expect(validateImageFile(makeImageFile(1024, "image/avif", "foto.avif"))).toBeNull();
  });

  it("rejects non-image types", () => {
    expect(validateImageFile(new File(["hola"], "pdf.pdf", { type: "application/pdf" }))).toBe(
      "Selecciona un archivo de imagen (JPG, PNG, WebP o AVIF).",
    );
  });

  it("rejects files above the preset input cap with a readable size", () => {
    const big = 20 * 1024 * 1024;
    expect(validateImageFile(makeImageFile(big))).toBe("La imagen debe pesar menos de 12 MB.");
    expect(validateImageFile(makeImageFile(big), "menuBackground")).toBe("La imagen debe pesar menos de 15 MB.");
  });
});

describe("resolveImageOptions", () => {
  it("applies per-preset caps and merges caller overrides", () => {
    expect(resolveImageOptions("dish").maxDimension).toBe(1200);
    expect(resolveImageOptions("menuBackground").maxDimension).toBe(1200);
    const merged = resolveImageOptions("dish", { maxDimension: 800 });
    expect(merged.maxDimension).toBe(800);
    expect(merged.minQuality).toBe(resolveImageOptions("dish").minQuality);
  });
});

describe("compressImageForUpload", () => {
  it("fails fast on invalid input before touching the canvas", async () => {
    const file = new File(["no soy una imagen"], "doc.pdf", { type: "application/pdf" });
    await expect(compressImageForUpload(file)).rejects.toThrow("Selecciona un archivo de imagen");
  });
});
