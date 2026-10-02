/** Informational placeholder. Enabling donations requires a reviewed wallet
 * flow and verified vault; no address, approval or transfer is exposed here. */
export function DonationButton() {
  return (
    <button type="button" className="button" disabled
      aria-label="Donate $PENIS (not open yet)"
      title="Direct donations are not open yet. The vault and donation flow must be verified first.">
      Donate $PENIS
    </button>
  );
}
