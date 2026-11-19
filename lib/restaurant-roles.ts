export const operationalRoles = [
  { value: "waiter", label: "Mesero" },
  { value: "chef", label: "Chef" },
  { value: "bartender", label: "Bartender" },
  { value: "barista", label: "Barista" },
  { value: "cashier", label: "Caja" },
] as const;

export type OperationalRole = typeof operationalRoles[number]["value"];
export type StaffRole = OperationalRole | "owner" | "manager";
export const roleLabels: Record<StaffRole, string> = {
  owner: "Dueño", manager: "Gerente", waiter: "Mesero", chef: "Chef",
  bartender: "Bartender", barista: "Barista", cashier: "Caja",
};

// Chef, bartender and barista are one *selection*. They remain three distinct
// stored roles because preparation stations are granted per station type; a
// person who picks this option can cover every kitchen/bar station.
export const kitchenRoles = ["chef", "bartender", "barista"] as const;
const kitchenRoleSet = new Set<string>(kitchenRoles);

export type RoleSelection = {
  value: "waiter" | "kitchen" | "cashier";
  label: string;
  hint?: string;
  roles: readonly OperationalRole[];
};

export const roleSelections: readonly RoleSelection[] = [
  { value: "waiter", label: "Mesero", hint: "El salón y las mesas.", roles: ["waiter"] },
  {
    value: "kitchen", label: "Cocina y barra", hint: "Chef, bartender y barista.",
    roles: kitchenRoles,
  },
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

// Collapse the three kitchen roles back into one label for display, so the UI
// reads the same way it did when the person selected their role.
export function formatRoles(roles: readonly StaffRole[]): string[] {
  const hasAllKitchen = kitchenRoles.every((role) => roles.includes(role));
  const labels: string[] = [];
  let kitchenAdded = false;
  for (const role of roles) {
    if (kitchenRoleSet.has(role)) {
      if (hasAllKitchen) {
        if (!kitchenAdded) labels.push(roleSelections[1].label);
        kitchenAdded = true;
      } else {
        // Partial kitchen roles can exist from the API or older data.
        labels.push(roleLabels[role]);
      }
      continue;
    }
    labels.push(roleLabels[role]);
  }
  return labels;
}

export const workspaces = [
  { value: "administracion", label: "Administración", description: "Menú, inventario, buffet, QR, equipo y sucursales.", roles: ["owner", "manager"] },
  { value: "mesas", label: "Mesas", description: "El salón y las mesas que atiendes.", roles: ["waiter"] },
  { value: "cocina", label: "Cocina y barra", description: "La preparación de cada pedido.", roles: ["chef", "bartender", "barista"] },
  { value: "caja", label: "Caja", description: "Las cuentas pendientes de pago.", roles: ["cashier"] },
  { value: "buffet", label: "Buffet", description: "Los menús y el servicio de buffet.", roles: ["waiter", "chef", "bartender", "barista"] },
] as const;
export type Workspace = typeof workspaces[number]["value"];

export function canAccessWorkspace(roles: ReadonlyArray<StaffRole>, workspace: Workspace) {
  if (roles.includes("owner") || roles.includes("manager")) return true;
  const definition = workspaces.find((entry) => entry.value === workspace)!;
  return roles.some((role) => (definition.roles as ReadonlyArray<StaffRole>).includes(role));
}
