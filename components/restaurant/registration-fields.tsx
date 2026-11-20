"use client";

import { useMutation } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  isRoleSelectionChecked, roleSelections, serviceModes, toggleRoleSelection, type OperationalRole, type ServiceMode,
} from "@/lib/restaurant-roles";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type RegistrationBranchOption = {
  _id: Id<"locations">;
  name: string;
  address: string | null;
};

export type RegistrationDetails = {
  kind: "owner" | "staff";
  displayName: string;
  restaurantName: string;
  serviceMode: ServiceMode;
  code: string;
  locationId: string;
  roles: OperationalRole[];
};

function normalizeInviteCode(raw: string) {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function RegistrationFields({ value, onChange, disabled, onBranchesChange }: {
  value: RegistrationDetails;
  onChange: (value: RegistrationDetails) => void;
  disabled: boolean;
  onBranchesChange?: (count: number) => void;
}) {
  const { kind, displayName, restaurantName, serviceMode, code, locationId, roles } = value;
  const lookupBranches = useMutation(api.restaurants.lookupCodeBranches);

  const [lookupState, setLookupState] = useState<
    | { status: "idle" }
    | { status: "found"; normalized: string; restaurantName: string; branches: RegistrationBranchOption[] }
    | { status: "error"; normalized: string; message: string }
  >({ status: "idle" });

  const latestValueRef = useRef(value);
  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  const normalizedCode = normalizeInviteCode(code);
  const isCompleteCode = /^OSR[A-HJ-NP-Z2-9]{12}$/.test(normalizedCode);

  useEffect(() => {
    if (kind !== "staff" || !isCompleteCode) return;
    let cancelled = false;
    void lookupBranches({ code: normalizedCode })
      .then((res) => {
        if (cancelled) return;
        if (!res.found) {
          setLookupState({ status: "error", normalized: normalizedCode, message: res.message });
          onBranchesChange?.(0);
          return;
        }
        setLookupState({
          status: "found",
          normalized: normalizedCode,
          restaurantName: res.restaurantName,
          branches: res.branches,
        });
        onBranchesChange?.(res.branches.length);
        const current = latestValueRef.current;
        const stillValid = res.branches.some((b) => b._id === current.locationId);
        if (res.branches.length === 1 && current.locationId !== res.branches[0]._id) {
          onChange({ ...current, locationId: res.branches[0]._id });
        } else if (res.branches.length > 1 && !stillValid && current.locationId !== "") {
          onChange({ ...current, locationId: "" });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLookupState({
          status: "error",
          normalized: normalizedCode,
          message: "No pudimos verificar el código. Vuelve a intentar.",
        });
        onBranchesChange?.(0);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, normalizedCode, isCompleteCode]);

  const effectiveLookup =
    kind !== "staff" || !isCompleteCode
      ? ({ status: "idle" } as const)
      : lookupState.status !== "idle" && lookupState.normalized === normalizedCode
        ? lookupState
        : ({ status: "loading" } as const);

  return (
    <>
      <fieldset disabled={disabled}>
        <legend className="onboarding-legend">¿Cuál es tu caso?</legend>
        <RadioGroup
          value={kind}
          onValueChange={(nextKind) => {
            onBranchesChange?.(0);
            onChange({ ...value, kind: nextKind as "owner" | "staff", locationId: "" });
          }}
          className="onboarding-choices"
          aria-label="Tipo de registro"
        >
          <Label className="onboarding-choice" htmlFor="register-owner">
            <RadioGroupItem value="owner" id="register-owner" />
            <span><strong>Soy dueño</strong><small>Registro mi restaurante</small></span>
          </Label>
          <Label className="onboarding-choice" htmlFor="register-staff">
            <RadioGroupItem value="staff" id="register-staff" />
            <span><strong>Soy empleado</strong><small>Tengo el código del restaurante</small></span>
          </Label>
        </RadioGroup>
      </fieldset>
      <div className="auth-field">
        <Label htmlFor="display-name">Tu nombre</Label>
        <Input id="display-name" name="name" autoComplete="name" value={displayName} onChange={(event) => onChange({ ...value, displayName: event.target.value })} placeholder="Nombre y apellido" maxLength={100} required disabled={disabled} />
      </div>
      {kind === "owner" ? (
        <>
          <div className="auth-field">
            <Label htmlFor="restaurant-name">Nombre del restaurante</Label>
            <Input id="restaurant-name" name="organization" autoComplete="organization" value={restaurantName} onChange={(event) => onChange({ ...value, restaurantName: event.target.value })} placeholder="Como lo conocen tus clientes" maxLength={100} required disabled={disabled} />
            <p className="small-note">Generaremos un código para que tu equipo pueda registrarse. Podrás copiarlo desde tu cuenta.</p>
          </div>
          <div className="auth-field">
            <Label htmlFor="registration-service-mode">Modalidad de servicio</Label>
            <select id="registration-service-mode" className="az-select min-h-11" value={serviceMode} disabled={disabled}
              onChange={(event) => onChange({ ...value, serviceMode: event.target.value as ServiceMode })}>
              {serviceModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
          </div>
        </>
      ) : (
        <>
          <div className="auth-field">
            <Label htmlFor="restaurant-code">Código del restaurante</Label>
            <Input
              id="restaurant-code"
              name="restaurant-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="restaurant-code-input"
              value={code}
              onChange={(event) => {
                onBranchesChange?.(0);
                onChange({ ...value, code: event.target.value.toUpperCase(), locationId: "" });
              }}
              placeholder="OSR-XXXX-XXXX-XXXX"
              maxLength={40}
              required
              disabled={disabled}
              aria-describedby="code-hint"
            />
            <p className="small-note" id="code-hint">
              {effectiveLookup.status === "loading" ? (
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  Verificando código y sucursales…
                </span>
              ) : effectiveLookup.status === "found" ? (
                <>
                  Restaurante: <strong>{effectiveLookup.restaurantName}</strong>
                  {effectiveLookup.branches.length === 1 ? ` · Sucursal: ${effectiveLookup.branches[0].name}` : ""}
                </>
              ) : effectiveLookup.status === "error" ? (
                <span className="text-destructive">{effectiveLookup.message}</span>
              ) : (
                "Te lo da el dueño de tu restaurante."
              )}
            </p>
          </div>
          {effectiveLookup.status === "found" && effectiveLookup.branches.length > 1 && (
            <div className="auth-field">
              <Label htmlFor="restaurant-branch">Sucursal o establecimiento</Label>
              <select
                id="restaurant-branch"
                className="az-select min-h-11"
                value={locationId}
                disabled={disabled}
                required
                onChange={(event) => onChange({ ...value, locationId: event.target.value })}
              >
                <option value="">Elige tu sucursal…</option>
                {effectiveLookup.branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>
                    {branch.name}
                    {branch.address ? ` — ${branch.address}` : ""}
                  </option>
                ))}
              </select>
              <p className="small-note">Solo verás la operación y mesas de la sucursal que elijas.</p>
            </div>
          )}
          <fieldset disabled={disabled} aria-describedby="roles-hint">
            <legend className="onboarding-legend">Tus roles en el restaurante</legend>
            <div className="role-choices">
              {roleSelections.map((selection) => (
                <Label key={selection.value} className="role-choice" htmlFor={`role-${selection.value}`}>
                  <Checkbox
                    id={`role-${selection.value}`}
                    checked={isRoleSelectionChecked(roles, selection)}
                    onCheckedChange={(checked) => onChange({
                      ...value, roles: toggleRoleSelection(roles, selection, checked === true),
                    })}
                  />
                  <span>{selection.label}<small>{selection.hint}</small></span>
                </Label>
              ))}
            </div>
            <p className="small-note" id="roles-hint">Puedes elegir más de uno. Tendrás acceso a las vistas correspondientes, sin esperar aprobación.</p>
          </fieldset>
        </>
      )}
    </>
  );
}
