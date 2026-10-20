# Wallet onboarding decisions

## PUMP approval warnings

Enrollment keeps the unlimited PUMP approval required by the current contract. Phantom support ticket #444396 confirmed that a warning about future withdrawals describes this permission. It is expected for this flow; that does not establish that every wallet warning is harmless or that Phantom endorses the program.

The review screen shows the PUMP mint, the expected delegate derived from the configured program and config, and the executable program address separately. The delegate is not read from an arbitrary existing token approval. For the current flagship, `HFRRErHwpCTDwnHEU1TDTeAK1gbA3pmkBqxBdhTyHyaf` is the delegate authority; `HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6` is the program.

The copy explains that the token approval is unlimited, while the current program enforces the protected balance and posted reward allowance. Payout attribution is checked off-chain, and upgrade authority can change program protections. Revoke stops future access; already-held contributions require a separate reclaim before release. Unexpected tokens, delegates, transfers or other warnings still need review. The site never dismisses warnings, signs for a holder or retries a declined request automatically.

Reference: [Phantom's domain and transaction warning guidance](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings).

## Local unsigned transaction capture

`NEXT_PUBLIC_WALLET_CAPTURE_ONLY=true` enables capture only with `NODE_ENV=development` (`next dev`). It is ignored by production builds, including Vercel previews and production deployments, so an accidentally retained flag cannot disable Stop collection, Revoke, Leave or reclaim. Do not configure it on hosting; restart the local development server after changing it. Next.js embeds public environment values at build time.

In development capture mode, every transaction action stops at the signer boundary. The page displays a diagnostic banner and exports only unsigned public transaction data; no wallet signature is requested and nothing is submitted. Use a normal session for actual recovery actions. The capture confirmation is shown only after the diagnostic signer successfully exports the unsigned request. Preparation failures, wallet mismatches, already-registered pledges, rejected requests and other errors retain their own handling.

## Optional public leaderboard names — planned, not implemented

The current leaderboard displays wallet addresses only. There is no name input, name storage, or name-publishing API. This section records the requirements agreed for the future naming feature; it does not claim that the feature ships in this PR.

### Holder flow

1. Naming stays optional and separate from enrollment. Skipping it must not block a pledge or change a wallet's contribution ranking.
2. The connected holder enters a display name and explicitly opts in to publishing it alongside their wallet address and contributions. The checkbox starts unchecked. Explain that this links the name and wallet publicly; removing it later cannot erase copies others already made.
3. Request a readable message signature from that same wallet after showing the exact name and public association. The message authorizes only the stated profile action, not token access or a transaction. Message signing has no network fee, but still needs a wallet confirmation; do not promise that a wallet can never show a warning.
4. Publish only after the server verifies the signature and consent. Renaming and removing a public name require fresh authorization from the same wallet. A wallet switch or edit invalidates an unfinished request. Wallets without message-signing support can still enroll without a name.

### Verification and storage requirements

- Bind the signature to this application's configured domain and network, the exact wallet, action (publish/update/remove), normalized display name, public opt-in, issued/expiry times, and a short-lived, single-use server challenge. Reject wrong domains, expired challenges, mismatched wallets and changed payloads.
- Verify the Ed25519 signature server-side against that wallet's public key and the exact issued message. A connected address, a local-storage value, or a browser claim that verification passed is not ownership proof.
- Use durable shared storage for profiles and challenges. Consuming the challenge and applying the profile action must be atomic across requests and server instances. Reject replay, including an old publish request replayed after removal, and stale updates that could overwrite a newer choice. An in-memory map or the serverless filesystem is not sufficient.
- Expose only opted-in profiles in public responses. Invalidate profile/leaderboard caches on updates and removal. Keep challenge records and operational metadata out of public responses and routine logs. No wallet secrets are needed.
- Validate name length and characters, render names as escaped text, and rate-limit challenge and profile writes. Keep the wallet address visible: a wallet signature proves control of that wallet, not that the holder is a particular person. Define impersonation, offensive-name reporting and moderation before launch; a display name must not be presented as verified real-world identity.

Before enabling names, choose and provision the durable store and implement the publishing API and UI together. Required checks include valid ownership, attempts to name another wallet, tampered names/consent/actions, expired or replayed challenges, stale concurrent changes, missing opt-in, removal and cache invalidation, and safe display of untrusted names. Until then the leaderboard remains address-only.

Reference: [Phantom message signatures](https://docs.phantom.com/solana/signing-a-message).
