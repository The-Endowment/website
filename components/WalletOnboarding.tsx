"use client";

import { useState, type ReactNode } from "react";
import { parseWalletAddress, phantomBrowseUrl } from "@/lib/wallet-onboarding";

export function PledgeSteps({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="pledge-steps" aria-label="Pledge setup">
      {["Connect", "Review", "Confirm"].map((label, index) => (
        <li key={label} aria-current={step === index + 1 ? "step" : undefined} data-complete={step > index + 1}>
          <span aria-hidden="true">{step > index + 1 ? "✓" : index + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

type WalletOnboardingProps = {
  phantomAvailable: boolean;
  connecting: boolean;
  connectionError: string | null;
  onPhantom: (expectedOwner: string | null) => void;
  manualWallets: ReactNode;
};

/** Connection only. No signature, token approval, or private-key handling here. */
export function WalletOnboarding({ phantomAvailable, connecting, connectionError, onPhantom, manualWallets }: WalletOnboardingProps) {
  const [route, setRoute] = useState<"phantom" | "fomo" | null>(null);
  const [fomoAddress, setFomoAddress] = useState("");
  const [mobileLink, setMobileLink] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const expectedOwner = parseWalletAddress(fomoAddress);
  function readDevice() {
    setMobileLink(phantomBrowseUrl(window.location.href));
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  }

  function choosePhantom() {
    readDevice();
    setRoute("phantom");
    if (phantomAvailable) onPhantom(null);
  }

  return (
    <div className="row-body wallet-onboarding">
      <PledgeSteps step={1} />
      <div>
        <h3 className="onboarding-title">Start with your wallet.</h3>
        <p className="muted small">Connect the wallet that holds your $PENIS and receives its PUMP rewards. Connecting alone gives no permission to move tokens.</p>
      </div>
      <div className="wallet-choices">
        <button type="button" className="wallet-choice" onClick={choosePhantom} disabled={connecting} aria-describedby="phantom-route-note">
          <span className="wallet-choice-mark" aria-hidden="true">P</span>
          <span>Connect Phantom<small id="phantom-route-note">{phantomAvailable ? "Open your wallet to connect" : "Browser extension or mobile app"}</small></span>
          <span className="wallet-choice-arrow" aria-hidden="true">↗</span>
        </button>
        <button type="button" className="wallet-choice" onClick={() => { readDevice(); setRoute(current => current === "fomo" ? null : "fomo"); }} disabled={connecting} aria-expanded={route === "fomo"} aria-controls={route === "fomo" ? "fomo-setup" : undefined} aria-describedby="fomo-route-note">
          <span className="wallet-choice-mark" aria-hidden="true">f</span>
          <span>I use Fomo<small id="fomo-route-note">Guided setup through Phantom</small></span>
          <span className="wallet-choice-arrow" aria-hidden="true">→</span>
        </button>
      </div>

      {route === "phantom" && !phantomAvailable && (
        <div className="onboarding-help" role="status">
          <h4>Open this page with Phantom</h4>
          <p>Phantom wasn&rsquo;t found in this browser. Install or unlock the extension, then reload this page. On your phone, use Phantom&rsquo;s browser.</p>
          <div className="actions">
            {isMobile && mobileLink && <a className="button button-primary" href={mobileLink}>Open in Phantom</a>}
            <a className="button" href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">Get Phantom</a>
            <button type="button" className="button" onClick={() => window.location.reload()}>Check again</button>
          </div>
          {!mobileLink && <p className="muted small">This local page only opens on this computer. Use the Phantom extension here.</p>}
        </div>
      )}

      {route === "fomo" && (
        <div id="fomo-setup" className="onboarding-help">
          <h4>Use your existing Fomo wallet</h4>
          <p>Direct connection from Fomo isn&rsquo;t available here yet. If you&rsquo;ve added that wallet to Phantom, we can connect it there and check that the addresses match.</p>
          <label className="wallet-address-label" htmlFor="fomo-public-address">Your Fomo Solana public address</label>
          <input id="fomo-public-address" className="wallet-address-input" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={fomoAddress} onChange={e => setFomoAddress(e.target.value)} disabled={connecting} aria-describedby="fomo-address-help" aria-invalid={Boolean(fomoAddress && !expectedOwner)} />
          <p id="fomo-address-help" className="muted small">Copy the public address beside your wallet in Fomo. We never ask for your private key or seed phrase.</p>
          {fomoAddress && !expectedOwner && <p role="alert" className="small">Enter a valid Solana public address.</p>}
          <div className="actions">
            <button type="button" className="button button-primary" disabled={!expectedOwner || !phantomAvailable || connecting} onClick={() => expectedOwner && onPhantom(expectedOwner)}>Connect that wallet in Phantom</button>
          </div>
          {!phantomAvailable && <p className="muted small">Open this page in a browser with Phantom installed to continue. {isMobile && mobileLink ? <a href={mobileLink}>Open in Phantom</a> : <a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">Get Phantom</a>}.</p>}
          <details>
            <summary>My Fomo wallet isn&rsquo;t in Phantom yet</summary>
            <p>Fomo supports exporting your wallet for use in another wallet app. Use the official Fomo and Phantom apps for that setup, then return here with the same Solana address. Creating a new wallet in Phantom won&rsquo;t connect your existing Fomo holdings.</p>
            <p><a href="https://fomo.family/blog/learn/fomo-vs-phantom-wallet" target="_blank" rel="noopener noreferrer">Fomo&rsquo;s wallet guide</a>. Keep any private key inside the wallet setup tools; never enter it on this site.</p>
          </details>
        </div>
      )}
      {connecting && <p role="status" className="note">Confirm the connection in your wallet. You&rsquo;ll review the pledge next.</p>}
      {connectionError && <p role="alert" className="note">{connectionError}</p>}
      <details className="manual-wallets">
        <summary>Manual connection / another wallet</summary>
        <p className="muted small">Connect your wallet to manage a pledge or reclaim pending contributions.</p>
        {manualWallets}
        <p className="muted small">Select your rewards wallet in the wallet app before connecting. You&rsquo;ll review the permission before approving anything.</p>
      </details>
    </div>
  );
}
