export type StoredDraftSummary = {
  key: string;
  count: number;
  summaryText: string;
};

const DRAFT_PREFIX = "osiris-draft:";

export function draftStorageKey(accountOrTableId: string): string {
  return `${DRAFT_PREFIX}${accountOrTableId}`;
}

export function loadStoredDraft<T>(accountOrTableId: string | undefined): T[] {
  if (!accountOrTableId || typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(accountOrTableId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredDraft<T>(accountOrTableId: string | undefined, items: T[]): void {
  if (!accountOrTableId || typeof window === "undefined") return;
  try {
    if (items.length === 0) {
      window.sessionStorage.removeItem(draftStorageKey(accountOrTableId));
    } else {
      window.sessionStorage.setItem(draftStorageKey(accountOrTableId), JSON.stringify(items));
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function readDraftSummaries(ids: string[]): Record<string, StoredDraftSummary> {
  const out: Record<string, StoredDraftSummary> = {};
  if (typeof window === "undefined") return out;
  for (const id of ids) {
    try {
      const raw = window.sessionStorage.getItem(draftStorageKey(id));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Array<{ name?: string; quantity?: number }>;
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      const count = parsed.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const summaryText = parsed
        .map((item) => `${item.quantity ?? 1} × ${item.name ?? "Platillo"}`)
        .join(", ");
      if (count > 0) {
        out[id] = { key: id, count, summaryText };
      }
    } catch {
      // Ignore malformed entry
    }
  }
  return out;
}
