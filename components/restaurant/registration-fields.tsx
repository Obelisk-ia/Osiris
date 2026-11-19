"use client";

import {
  isRoleSelectionChecked, roleSelections, toggleRoleSelection, type OperationalRole,
} from "@/lib/restaurant-roles";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type RegistrationDetails = {
  kind: "owner" | "staff";
  displayName: string;
  restaurantName: string;
  code: string;
  roles: OperationalRole[];
};

export function RegistrationFields({ value, onChange, disabled }: {
  value: RegistrationDetails;
  onChange: (value: RegistrationDetails) => void;
  disabled: boolean;
}) {
  const { kind, displayName, restaurantName, code, roles } = value;
  return (
    <>
      <fieldset disabled={disabled}>
        <legend className="onboarding-legend">¿Cuál es tu caso?</legend>
        <RadioGroup value={kind} onValueChange={(kind) => onChange({ ...value, kind: kind as "owner" | "staff" })} className="onboarding-choices" aria-label="Tipo de registro">
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
        <div className="auth-field">
          <Label htmlFor="restaurant-name">Nombre del restaurante</Label>
          <Input id="restaurant-name" name="organization" autoComplete="organization" value={restaurantName} onChange={(event) => onChange({ ...value, restaurantName: event.target.value })} placeholder="Como lo conocen tus clientes" maxLength={100} required disabled={disabled} />
          <p className="small-note">Generaremos un código para que tu equipo pueda registrarse. Podrás copiarlo desde tu cuenta.</p>
        </div>
      ) : (
        <>
          <div className="auth-field">
            <Label htmlFor="restaurant-code">Código del restaurante</Label>
            <Input id="restaurant-code" name="restaurant-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="restaurant-code-input" value={code} onChange={(event) => onChange({ ...value, code: event.target.value.toUpperCase() })} placeholder="OSR-XXXX-XXXX-XXXX" maxLength={40} required disabled={disabled} aria-describedby="code-hint" />
            <p className="small-note" id="code-hint">Te lo da el dueño de tu restaurante.</p>
          </div>
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
