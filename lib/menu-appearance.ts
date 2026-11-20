export const MAX_MENU_BACKGROUND_BYTES = 3 * 1024 * 1024;

export type MenuBackground =
  | { kind: "default" }
  | { kind: "color"; color: string }
  | { kind: "photo"; url: string };
