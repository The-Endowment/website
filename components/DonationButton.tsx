/** Shown disabled until donations open with the contract. No address, approval
 * or transfer is exposed here. */
export function DonationButton() {
  return (
    <button type="button" className="button" disabled
      aria-label="Donate $PENIS (coming soon)"
      title="Donations open after the contract is live.">
      Donate $PENIS
    </button>
  );
}
