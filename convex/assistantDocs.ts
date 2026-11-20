"use node";

import { v } from "convex/values";
import { extractText } from "unpdf";
import { internalAction } from "./_generated/server";

async function extractDocumentText(
  blob: Blob,
  fileName?: string,
  mimeType?: string,
): Promise<{ format: "pdf" | "text"; pageCount: number; fullText: string }> {
  const lowerName = (fileName ?? "").toLowerCase();
  const lowerMime = (mimeType ?? blob.type ?? "").toLowerCase();
  const isPdf = lowerName.endsWith(".pdf") || lowerMime === "application/pdf";

  if (isPdf) {
    const arrayBuffer = await blob.arrayBuffer();
    const { totalPages, text } = await extractText(new Uint8Array(arrayBuffer), {
      mergePages: true,
    });
    return {
      format: "pdf",
      pageCount: totalPages,
      fullText: text.replace(/\r\n/g, "\n").trim(),
    };
  }

  const rawText = await blob.text();
  return {
    format: "text",
    pageCount: 1,
    fullText: rawText.replace(/\r\n/g, "\n").trim(),
  };
}

export const inspectDocument = internalAction({
  args: {
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
  },
  returns: v.object({
    format: v.union(v.literal("pdf"), v.literal("text")),
    pageCount: v.number(),
    totalChars: v.number(),
    hasMore: v.boolean(),
    previewText: v.string(),
  }),
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("No se encontró el documento en almacenamiento.");
    }
    const { format, pageCount, fullText } = await extractDocumentText(
      blob,
      args.fileName,
      args.mimeType,
    );
    const previewLimit = 4000;
    return {
      format,
      pageCount,
      totalChars: fullText.length,
      hasMore: fullText.length > previewLimit,
      previewText: fullText.slice(0, previewLimit),
    };
  },
});

export const readDocumentChunk = internalAction({
  args: {
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    startChar: v.optional(v.number()),
    maxChars: v.optional(v.number()),
  },
  returns: v.object({
    totalChars: v.number(),
    startChar: v.number(),
    returnedChars: v.number(),
    hasMore: v.boolean(),
    nextStartChar: v.number(),
    text: v.string(),
  }),
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("No se encontró el documento en almacenamiento.");
    }
    const { fullText } = await extractDocumentText(blob, args.fileName, args.mimeType);
    const start = Math.max(0, Math.floor(args.startChar ?? 0));
    const limit = Math.min(12000, Math.max(500, Math.floor(args.maxChars ?? 8000)));
    const chunk = fullText.slice(start, start + limit);
    const nextStart = start + chunk.length;

    return {
      totalChars: fullText.length,
      startChar: start,
      returnedChars: chunk.length,
      hasMore: nextStart < fullText.length,
      nextStartChar: nextStart,
      text: chunk,
    };
  },
});
