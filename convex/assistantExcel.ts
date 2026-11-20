"use node";

import { v } from "convex/values";
import * as XLSX from "xlsx";
import { internalAction } from "./_generated/server";

function cleanCellValue(val: unknown): string | number | boolean | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "boolean") return val;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim() || null;
}

function sheetToMatrix(sheet: XLSX.WorkSheet): Array<Array<string | number | boolean | null>> {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  return raw
    .map((row) => (Array.isArray(row) ? row.map(cleanCellValue) : []))
    .filter((row) => row.some((cell) => cell !== null));
}

function columnLetters(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function formatRowWithColumns(row: Array<string | number | boolean | null>, rowIndex: number) {
  const cells: Record<string, string | number | boolean> = {};
  for (let i = 0; i < row.length; i++) {
    const val = row[i];
    if (val !== null) {
      cells[columnLetters(i)] = val;
    }
  }
  return { rowNumber: rowIndex + 1, cells };
}

export const inspectWorkbook = internalAction({
  args: {
    storageId: v.id("_storage"),
  },
  returns: v.object({
    sheetNames: v.array(v.string()),
    sheets: v.array(
      v.object({
        name: v.string(),
        totalRows: v.number(),
        maxColumns: v.number(),
        previewRows: v.array(
          v.object({
            rowNumber: v.number(),
            cells: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, { storageId }) => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) {
      throw new Error("No se encontró el archivo en almacenamiento.");
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const matrix = sheet ? sheetToMatrix(sheet) : [];
      const maxColumns = matrix.reduce((acc, row) => Math.max(acc, row.length), 0);
      const previewRows = matrix.slice(0, 20).map((row, idx) => formatRowWithColumns(row, idx));
      return {
        name,
        totalRows: matrix.length,
        maxColumns,
        previewRows,
      };
    });

    return {
      sheetNames: workbook.SheetNames,
      sheets,
    };
  },
});

export const readSheetRows = internalAction({
  args: {
    storageId: v.id("_storage"),
    sheetName: v.optional(v.string()),
    startRow: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    sheetName: v.string(),
    totalRows: v.number(),
    startRow: v.number(),
    returnedCount: v.number(),
    hasMore: v.boolean(),
    rows: v.array(
      v.object({
        rowNumber: v.number(),
        cells: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("No se encontró el archivo en almacenamiento.");
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    const targetSheetName =
      args.sheetName && workbook.SheetNames.includes(args.sheetName)
        ? args.sheetName
        : workbook.SheetNames[0];

    if (!targetSheetName) {
      throw new Error("El archivo no contiene hojas válidas.");
    }

    const sheet = workbook.Sheets[targetSheetName];
    const matrix = sheet ? sheetToMatrix(sheet) : [];

    const startIndex = Math.max(0, Math.floor((args.startRow ?? 1) - 1));
    const maxLimit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 100)));
    const slice = matrix.slice(startIndex, startIndex + maxLimit);
    const rows = slice.map((row, i) => formatRowWithColumns(row, startIndex + i));

    return {
      sheetName: targetSheetName,
      totalRows: matrix.length,
      startRow: startIndex + 1,
      returnedCount: rows.length,
      hasMore: startIndex + rows.length < matrix.length,
      rows,
    };
  },
});
