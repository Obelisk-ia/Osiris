export const operationalRoles = [
  { value: "waiter", label: "Mesero" },
  { value: "chef", label: "Chef" },
  { value: "bar", label: "Barra" },
  { value: "bartender", label: "Bartender" },
  { value: "barista", label: "Barista" },
  { value: "cashier", label: "Caja" },
] as const;

export type OperationalRole = typeof operationalRoles[number]["value"];
export type StaffRole = OperationalRole | "owner" | "manager";
export type KitchenRole = "chef" | "bar" | "bartender" | "barista";
export type PreparationArea = "kitchen" | "bar" | "cocktails" | "coffee";

export const roleLabels: Record<StaffRole, string> = {
  owner: "Dueño",
  manager: "Gerente",
  waiter: "Mesero",
  chef: "Chef",
  bar: "Barra",
  bartender: "Bartender",
  barista: "Barista",
  cashier: "Caja",
};

export const kitchenRoles: readonly KitchenRole[] = ["chef", "bar", "bartender", "barista"] as const;

export const PREPARATION_AREAS: readonly PreparationArea[] = [
  "kitchen",
  "bar",
  "cocktails",
  "coffee",
] as const;

export const PREPARATION_AREA_META: Record<
  PreparationArea,
  { area: PreparationArea; name: string; role: KitchenRole }
> = {
  kitchen: { area: "kitchen", name: "Cocina", role: "chef" },
  bar: { area: "bar", name: "Barra", role: "bar" },
  cocktails: { area: "cocktails", name: "Coctelería", role: "bartender" },
  coffee: { area: "coffee", name: "Cafetería", role: "barista" },
};

export const ROLE_TO_AREA: Record<KitchenRole, PreparationArea> = {
  chef: "kitchen",
  bar: "bar",
  bartender: "cocktails",
  barista: "coffee",
};

export function areasForStaffRoles(roles: readonly StaffRole[]): PreparationArea[] {
  if (roles.includes("owner") || roles.includes("manager")) {
    return [...PREPARATION_AREAS];
  }
  const areas: PreparationArea[] = [];
  for (const area of PREPARATION_AREAS) {
    if (roles.includes(PREPARATION_AREA_META[area].role)) {
      areas.push(area);
    }
  }
  return areas;
}

export function isKitchenStaffRole(role: StaffRole): role is KitchenRole {
  return role === "chef" || role === "bar" || role === "bartender" || role === "barista";
}

export type RoleSelection = {
  value: OperationalRole;
  label: string;
  hint?: string;
  roles: readonly OperationalRole[];
};

export const roleSelections: readonly RoleSelection[] = [
  { value: "waiter", label: "Mesero", hint: "El salón y las mesas.", roles: ["waiter"] },
  { value: "chef", label: "Chef (Cocina)", hint: "Platillos y comandas de cocina.", roles: ["chef"] },
  { value: "bar", label: "Barra", hint: "Barra fría, sushi y preparación en barra.", roles: ["bar"] },
  { value: "bartender", label: "Bartender (Coctelería)", hint: "Cócteles, tragos y mixología.", roles: ["bartender"] },
  { value: "barista", label: "Barista (Cafetería)", hint: "Café, té y bebidas calientes.", roles: ["barista"] },
  { value: "cashier", label: "Caja", hint: "Cobros y cortes.", roles: ["cashier"] },
];

export function isRoleSelectionChecked(roles: readonly StaffRole[], selection: RoleSelection) {
  return selection.roles.every((role) => roles.includes(role));
}

export function toggleRoleSelection(
  roles: readonly OperationalRole[], selection: RoleSelection, checked: boolean,
): OperationalRole[] {
  if (checked) return [...new Set([...roles, ...selection.roles])];
  return roles.filter((role) => !selection.roles.includes(role));
}

export function formatRoles(roles: readonly StaffRole[]): string[] {
  return roles.map((role) => roleLabels[role]);
}

export const workspaces = [
  { value: "administracion", label: "Administración", description: "Menú, inventario, buffet, QR, equipo y sucursales.", roles: ["owner", "manager"] },
  { value: "mesas", label: "Mesas", description: "El salón y las mesas que atiendes.", roles: ["waiter", "cashier"] },
  { value: "cocina", label: "Cocina y estaciones", description: "La preparación de cada pedido por área.", roles: ["chef", "bar", "bartender", "barista"] },
  { value: "caja", label: "Caja", description: "Cobros, turnos, cortes e historial.", roles: ["cashier"] },
  { value: "buffet", label: "Buffet", description: "Los menús y el servicio de buffet.", roles: ["waiter", "chef", "bar", "bartender", "barista"] },
] as const;
export type Workspace = typeof workspaces[number]["value"];

export function canAccessWorkspace(roles: ReadonlyArray<StaffRole>, workspace: Workspace) {
  if (roles.includes("owner") || roles.includes("manager")) return true;
  const definition = workspaces.find((entry) => entry.value === workspace)!;
  return roles.some((role) => (definition.roles as ReadonlyArray<StaffRole>).includes(role));
}
