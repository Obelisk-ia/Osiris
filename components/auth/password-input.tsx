"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordInput({
  id = "password",
  label = "Contraseña",
  value,
  onChange,
  disabled,
  newPassword = false,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="password-field">
        <Input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={newPassword ? "new-password" : "current-password"}
          placeholder={newPassword ? "Mínimo 10 caracteres" : "Tu contraseña"}
          minLength={newPassword ? 10 : undefined}
          disabled={disabled}
          required
        />
        <Button
          variant="ghost"
          type="button"
          className="password-toggle"
          aria-controls={id}
          aria-pressed={visible}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          onClick={() => setVisible(!visible)}
          disabled={disabled}
        >{visible ? "Ocultar" : "Mostrar"}</Button>
      </div>
      {newPassword && <p className="small-note">Usa al menos 10 caracteres y evita contraseñas comunes.</p>}
    </div>
  );
}
