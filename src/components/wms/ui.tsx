"use client";

import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent" | "brand";
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  iconLeft?: ReactNode;
  style?: CSSProperties;
};

export function Button({ children, onClick, variant = "primary", disabled = false, type = "button", form, className = "", size = "md", block = false, iconLeft, style }: ButtonProps) {
  return (
    <button
      type={type}
      form={form}
      disabled={disabled}
      onClick={onClick}
      style={style}
      className={cn("mm-btn", `mm-btn--${variant}`, `mm-btn--${size}`, block && "mm-btn--block", className)}
    >
      {iconLeft}
      {children}
    </button>
  );
}

export function Card({
  children,
  title,
  action,
  className = "",
  pad = true,
  brand = false,
}: {
  children: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  pad?: boolean;
  brand?: boolean;
}) {
  return (
    <section className={cn("mm-card", pad && "mm-card--pad", brand && "mm-card--brand", className)}>
      {title || action ? (
        <div className="mm-card__head">
          {title ? <h2 className="mm-card__title">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "emerald" | "amber" | "rose" | "brand" | "accent" | "danger" | "warning" }) {
  const toneMap = {
    slate: "neutral",
    emerald: "accent",
    amber: "warning",
    rose: "danger",
    brand: "brand",
    accent: "accent",
    danger: "danger",
    warning: "warning",
  } as const;
  return (
    <div className="mm-stat">
      <span className={`mm-stat__accent mm-stat__accent--${toneMap[tone]}`} />
      <div className="mm-stat__label">{label}</div>
      <div className={`mm-stat__value mm-stat__value--${toneMap[tone]}`}>{value}</div>
    </div>
  );
}

export function TextField(props: InputHTMLAttributes<HTMLInputElement> & { label: string; mono?: boolean }) {
  const { label, className, mono, ...rest } = props;
  return (
    <label className="mm-field">
      <span className="mm-field__label">{label}</span>
      <input {...rest} className={cn("mm-input", mono && "mm-input--mono", className)} />
    </label>
  );
}

export function SelectField(props: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const { label, children, className, ...rest } = props;
  return (
    <label className="mm-field">
      <span className="mm-field__label">{label}</span>
      <span className="mm-select-wrap">
        <select {...rest} className={cn("mm-select", className)}>
          {children}
        </select>
      </span>
    </label>
  );
}

export function Tag({ children, tone = "neutral", mono = false }: { children: ReactNode; tone?: "neutral" | "brand" | "accent"; mono?: boolean }) {
  return <span className={cn("mm-tag", tone !== "neutral" && `mm-tag--${tone}`, mono && "mm-tag--mono")}>{children}</span>;
}

const statusTone: Record<string, "teal" | "blue" | "amber" | "red" | "slate"> = {
  IN_FACTORY: "teal",
  RECEIVED_AT_WAREHOUSE: "teal",
  RECEIVED_AT_DESTINATION: "teal",
  DELIVERED: "teal",
  IN_TRANSIT: "blue",
  IN_TRANSIT_TRANSFER: "blue",
  DISPATCHED_TO_CUSTOMER: "blue",
  DISPATCH_PENDING: "amber",
  TRANSFER_PENDING: "amber",
  EXPIRED: "amber",
  UNDER_INVESTIGATION: "amber",
  DAMAGED: "red",
  LOST: "red",
  BLOCKED: "red",
  VOIDED: "red",
  REVERSED: "red",
};

const statusLabel: Record<string, string> = {
  IN_FACTORY: "AVAILABLE",
  RECEIVED_AT_WAREHOUSE: "AVAILABLE",
  RECEIVED_AT_DESTINATION: "AVAILABLE",
  IN_TRANSIT: "IN TRANSIT",
  IN_TRANSIT_TRANSFER: "IN TRANSIT",
  DISPATCHED_TO_CUSTOMER: "CUSTOMER DISPATCHED",
  UNDER_INVESTIGATION: "INVESTIGATION",
};

export function StatusBadge({ status, children, tone }: { status?: string; children?: ReactNode; tone?: "teal" | "blue" | "amber" | "red" | "slate" }) {
  const resolved = tone ?? (status ? statusTone[status] : undefined) ?? "slate";
  return (
    <span className={`mm-badge mm-badge--${resolved}`}>
      <span className="mm-badge__dot" />
      {children ?? (status ? statusLabel[status] ?? status : status)}
    </span>
  );
}

export function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={cn("mm-empty", compact && "mm-empty--compact")}>{text}</div>;
}
