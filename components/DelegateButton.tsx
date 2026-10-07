import Link from "next/link";
import { DELEGATION_CLOSED_NOTE, DELEGATION_OPEN } from "@/lib/site";

/** A button to /delegate while pledging is open; nothing while it is closed (a grayed-out button
 * that does nothing is just clutter). */
export function DelegateButton({ label, primary = false }: { label: string; primary?: boolean }) {
  if (!DELEGATION_OPEN) return null;
  return (
    <Link href="/delegate" className={primary ? "button button-primary" : "button"}>
      {label}
    </Link>
  );
}

/** The one line that says when pledging opens, while it is closed. */
export function DelegationNote() {
  return DELEGATION_OPEN ? null : <p className="muted small">{DELEGATION_CLOSED_NOTE}</p>;
}
