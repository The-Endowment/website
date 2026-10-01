import Link from "next/link";
import { DELEGATION_CLOSED_NOTE, DELEGATION_OPEN } from "@/lib/site";

/** A link to /delegate, shown grayed out (and not clickable) until delegation opens. */
export function DelegateButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const className = primary ? "button button-primary" : "button";
  if (DELEGATION_OPEN) {
    return (
      <Link href="/delegate" className={className}>
        {label}
      </Link>
    );
  }
  return (
    <span className={`${className} button-disabled`} aria-disabled="true" title={DELEGATION_CLOSED_NOTE}>
      {label}
    </span>
  );
}

/** The line under a closed Delegate button. */
export function DelegationNote() {
  return DELEGATION_OPEN ? null : <p className="muted small">{DELEGATION_CLOSED_NOTE}</p>;
}
