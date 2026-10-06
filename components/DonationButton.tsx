/** Shown disabled until donations open with the contract. No address, approval
 * or transfer is exposed here. */
export function DonationButton() {
  return (
    <button type="button" className="button" disabled
      aria-label="Donate $PENIS (opens with the contract)"
      title="Donations open with the contract.">
      Donate $PENIS
    </button>
  );
}
