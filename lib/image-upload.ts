import type { Id } from "@/convex/_generated/dataModel";

export type ImageUploadPreset = "dish" | "menuBackground";

export interface ImageCompressionOptions {
  /** Longest edge in pixels; smaller images are never upscaled. */
  maxDimension: number;
  /** Starting encoder quality (0–1). Kept high so food & menu photography stays sharp. */
  initialQuality: number;
  /** Lower bound on quality (0–1) so photos never look blocky or muddy. */
  minQuality: number;
  /** Soft byte target used to step quality down gently within [minQuality, initialQuality]. */
  targetMaxBytes: number;
  /** Maximum raw input size accepted from the user before compression. */
  maxInputBytes: number;
  /** Quality decrement per pass when above targetMaxBytes. */
  qualityStep: number;
  /** Background color used only if falling back to JPEG for images with transparency. */
  jpegBackground: string;
}

export interface CompressedImageResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
  wasReencoded: boolean;
}

export interface UploadedImageResult extends CompressedImageResult {
  storageId: Id<"_storage">;
}

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export const IMAGE_UPLOAD_PRESETS: Record<ImageUploadPreset, ImageCompressionOptions> = {
  // Dish cards render up to ~400–500px CSS; 1200px keeps 2.5–3× Retina crispness
  // while shrinking typical 3–8 MB phone photos down to ~100–250 KB WebP.
  dish: {
    maxDimension: 1200,
    initialQuality: 0.86,
    minQuality: 0.76,
    targetMaxBytes: 300 * 1024,
    maxInputBytes: 12 * 1024 * 1024,
    qualityStep: 0.04,
    jpegBackground: "#f7f1de",
  },
  // Full-bleed menu background / hero cover. Like every other upload it is capped
  // at 1200px, but it encodes at the highest quality in the preset table so the
  // menu stays crisp on desktop & high-DPI screens while staying under ~600 KB.
  menuBackground: {
    maxDimension: 1200,
    initialQuality: 0.88,
    minQuality: 0.78,
    targetMaxBytes: 600 * 1024,
    maxInputBytes: 15 * 1024 * 1024,
    qualityStep: 0.04,
    jpegBackground: "#efe7d2",
  },
};

export function resolveImageOptions(
  preset: ImageUploadPreset,
  overrides?: Partial<ImageCompressionOptions>,
): ImageCompressionOptions {
  return { ...IMAGE_UPLOAD_PRESETS[preset], ...overrides };
}

/** Validates type and raw file size before previewing or compressing. Returns an error message or null. */
export function validateImageFile(
  file: File,
  preset: ImageUploadPreset = "dish",
  overrides?: Partial<ImageCompressionOptions>,
): string | null {
  const options = resolveImageOptions(preset, overrides);
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    return "Selecciona un archivo de imagen (JPG, PNG, WebP o AVIF).";
  }
  if (file.size > options.maxInputBytes) {
    const maxMb = Math.round(options.maxInputBytes / (1024 * 1024));
    return `La imagen debe pesar menos de ${maxMb} MB.`;
  }
  return null;
}

/** Scales width/height proportionally to fit inside maxDimension without ever upscaling. */
export function fitWithinMaxDimension(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number; resized: boolean } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension || longest <= 0) {
    return { width, height, resized: false };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

let cachedWebpSupport: boolean | null = null;

function supportsWebpEncoding(): boolean {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    cachedWebpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    cachedWebpSupport = false;
  }
  return cachedWebpSupport;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

async function decodeImageFile(file: File): Promise<DecodedImage> {
  // createImageBitmap decodes off-main-thread and honors EXIF orientation by default.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall back to HTMLImageElement below if createImageBitmap rejects a valid format.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No pudimos leer la imagen seleccionada."));
      el.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

function replaceExtension(filename: string, ext: "webp" | "jpg"): string {
  const trimmed = filename.trim() || "imagen";
  const base = trimmed.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

/**
 * Resizes and compresses an image in the browser while preserving sharp menu quality.
 * - Encodes to high-quality WebP (with JPEG fallback for older browsers).
 * - Never upscales small images and never drops quality below `minQuality`.
 * - Keeps an in-bounds file only if it's already in the output format and re-encoding wouldn't shrink it.
 */
export async function compressImageForUpload(
  file: File,
  preset: ImageUploadPreset = "dish",
  overrides?: Partial<ImageCompressionOptions>,
): Promise<CompressedImageResult> {
  const validationError = validateImageFile(file, preset, overrides);
  if (validationError) {
    throw new Error(validationError);
  }

  const options = resolveImageOptions(preset, overrides);
  const decoded = await decodeImageFile(file);

  try {
    const { width, height, resized } = fitWithinMaxDimension(
      decoded.width,
      decoded.height,
      options.maxDimension,
    );

    const useWebp = supportsWebpEncoding();
    const targetMime = useWebp ? "image/webp" : "image/jpeg";

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Tu navegador no pudo preparar la imagen para subirla.");
    }

    if (!useWebp) {
      // Prevent transparent PNG areas from turning black in JPEG fallback.
      ctx.fillStyle = options.jpegBackground;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);

    let quality = options.initialQuality;
    let blob = await canvasToBlob(canvas, targetMime, quality);

    // Some browsers return PNG or null when they can't encode WebP.
    if (useWebp && blob?.type !== "image/webp") {
      ctx.fillStyle = options.jpegBackground;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(decoded.source, 0, 0, width, height);
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }

    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) {
      throw new Error("No pudimos optimizar la imagen seleccionada.");
    }

    const activeMime = blob.type;
    const activeExt = activeMime === "image/webp" ? "webp" : "jpg";

    // Gently step quality down only if still above targetMaxBytes, never below minQuality.
    while (blob.size > options.targetMaxBytes && quality - options.qualityStep >= options.minQuality - 1e-6) {
      quality = Math.max(options.minQuality, Number((quality - options.qualityStep).toFixed(2)));
      const nextBlob = await canvasToBlob(canvas, activeMime, quality);
      if (!nextBlob || nextBlob.type !== activeMime) break;
      blob = nextBlob;
    }

    // Avoid re-encoding a smaller original WebP (or JPEG when using the fallback).
    if (!resized && file.type.toLowerCase() === activeMime && blob.size >= file.size) {
      return {
        file,
        originalBytes: file.size,
        compressedBytes: file.size,
        width,
        height,
        wasReencoded: false,
      };
    }

    const compressedFile = new File([blob], replaceExtension(file.name, activeExt), {
      type: activeMime,
      lastModified: Date.now(),
    });

    return {
      file: compressedFile,
      originalBytes: file.size,
      compressedBytes: compressedFile.size,
      width,
      height,
      wasReencoded: true,
    };
  } finally {
    decoded.cleanup();
  }
}

/**
 * Compresses an image with the chosen preset and uploads it directly to Convex `_storage`.
 * Reusable for dish photos, menu backgrounds, or any future image uploads.
 */
export async function uploadCompressedImage({
  file,
  preset = "dish",
  generateUploadUrl,
  options,
}: {
  file: File;
  preset?: ImageUploadPreset;
  generateUploadUrl: () => Promise<string>;
  options?: Partial<ImageCompressionOptions>;
}): Promise<UploadedImageResult> {
  const compressed = await compressImageForUpload(file, preset, options);
  const uploadUrl = await generateUploadUrl();
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": compressed.file.type || "application/octet-stream" },
    body: compressed.file,
  });
  if (!res.ok) {
    throw new Error("No pudimos subir la imagen.");
  }
  const json = (await res.json()) as { storageId?: string };
  if (!json.storageId) {
    throw new Error("Respuesta inesperada al subir la imagen.");
  }
  return {
    ...compressed,
    storageId: json.storageId as Id<"_storage">,
  };
}
