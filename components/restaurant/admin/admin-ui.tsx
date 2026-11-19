"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatShortDate, toRoman } from "@/lib/format";

export function EditorialTitle({ title }: { title: string }) {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) {
    return (
      <>
        {title}
        <span className="coral-dot">.</span>
      </>
    );
  }
  const last = words.pop()!;
  return (
    <>
      {words.join(" ")} <em>{last}</em>
      <span className="coral-dot">.</span>
    </>
  );
}

export function AdminPageHead({
  index,
  total,
  restaurantName,
  locationName,
  title,
  subtitle,
  actions,
}: {
  index: number;
  total: number;
  restaurantName: string;
  locationName: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const pad = (n: number) => String(n).padStart(3, "0");
  return (
    <>
      <div className="az-sec-rule">
        <span className="roman">
          {toRoman(index)}
          <span className="coral-dot">.</span>
        </span>
        <span className="az-sec-meta">
          {restaurantName} · {locationName} · {formatShortDate()}
        </span>
        <span className="az-sec-page">
          {pad(index)} / {pad(total)}
        </span>
      </div>
      <header className="az-page-head">
        <h1>
          <EditorialTitle title={title} />
        </h1>
        {subtitle && <p>{subtitle}</p>}
        {actions && <div className="az-toolbar mt-1">{actions}</div>}
      </header>
    </>
  );
}

export function AdminModal({
  title,
  wide,
  onClose,
  footer,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="az-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`az-modal${wide ? " wide" : ""}`}>
        <div className="az-modal-head">
          <h2>{title}</h2>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="az-modal-body">{children}</div>
        {footer && <div className="az-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirmar",
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AdminModal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={danger ? "destructive" : "default"}
            className={danger ? undefined : "site-button"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Procesando…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-[#2a2620]">{message}</p>
    </AdminModal>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="az-card">
      <div className="az-empty">
        {icon}
        <h3>{title}</h3>
        <p className="text-sm max-w-[44ch]">{description}</p>
        {action}
      </div>
    </div>
  );
}

export type ToastState = { message: string; kind: "ok" | "err" } | null;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((message: string, kind: "ok" | "err" = "ok") => {
    setToast({ message, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.kind === "err" ? 5000 : 3200,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, showToast };
}

export function ToastBanner({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div
      className={`az-toast${toast.kind === "err" ? " err" : ""}`}
      role={toast.kind === "err" ? "alert" : "status"}
    >
      {toast.kind === "err" ? (
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Check className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span>{toast.message}</span>
    </div>
  );
}
