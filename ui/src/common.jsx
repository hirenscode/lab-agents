import React from "react";
import { Button as HexButton } from "./hexagon/components/Button/Button.jsx";
import { Card as HexCard } from "./hexagon/components/Card/Card.jsx";
import { Badge } from "./hexagon/components/Badge/Badge.jsx";
import { runLabels } from "./model.mjs";

export function Button({ children, variant = "secondary", type = "button", className = "", ...props }) {
  const colors = {
    primary: ["var(--accent)", "#fff", "var(--accent)"],
    secondary: ["var(--surface)", "var(--text)", "var(--line-strong)"],
    danger: ["var(--red-surface)", "var(--red)", "var(--red-line)"],
    plain: ["transparent", "var(--muted)", "transparent"],
  };
  const [background, color, borderColor] = colors[variant];
  return <HexButton {...props} type={type} variant={variant === "primary" ? "primary" : "secondary"} size="small"
    className={`button button-${variant} ${className}`} style={{
      background, color, borderColor, boxShadow: "none", fontFamily: "inherit",
      fontSize: "0.85rem", borderRadius: "8px", minHeight: "36px",
    }}>{children}</HexButton>;
}

export function Card({ children, className = "", ...props }) {
  return <HexCard elevation="none" padding="none" {...props} className={`card ${className}`} style={{
    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "14px", color: "var(--text)",
  }}>{children}</HexCard>;
}

const tones = { running: "green", done: "green", online: "green", queued: "violet", waiting_for_brain: "amber",
  awaiting_approval: "amber", scheduled: "blue", failed: "red", killed: "red" };

export function Status({ state, children }) {
  const tone = tones[state] ?? "quiet";
  return <Badge size="medium" className={`status status-${tone}`} style={{
    display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", padding: "4px 9px", fontWeight: 600,
    fontSize: "0.75rem", whiteSpace: "nowrap", background: `var(--chip-${tone}-bg)`, color: `var(--chip-${tone})`,
  }}><span className="status-dot" aria-hidden="true" />{children ?? runLabels[state] ?? state}</Badge>;
}

export function Heading({ title, description, action, back }) {
  return <header className="heading">
    <div>{back && <a className="back" href={back.href}>‹ {back.label}</a>}
      <h1 tabIndex="-1">{title}</h1>{description && <p>{description}</p>}
    </div>
    {action && <div className="heading-actions">{action}</div>}
  </header>;
}

export function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ErrorText({ message }) {
  return message ? <div className="error" role="alert">{message}</div> : null;
}

export function Empty({ title, children, action }) {
  return <div className="empty"><div className="empty-mark" aria-hidden="true"><i /><i /><i /></div>
    <h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}
