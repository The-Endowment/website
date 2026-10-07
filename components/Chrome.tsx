import Link from "next/link";
import { SolidLogo } from "@/components/Logo";
import { DELEGATION_OPEN, links } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <Link href="/" className="brand" aria-label="$PENIS home">
          <SolidLogo className="brand-mark" />
          <span>$PENIS</span>
        </Link>
        <nav aria-label="Primary" className="nav">
          <Link href="/endowment" className="nav-endowment">Endowment</Link>
          <Link href="/thesis">Thesis</Link>
          <Link href="/#coin">The coin</Link>
          {/* Always reachable: a holder can take a held collection back here even while pledging is closed. */}
          <Link href="/delegate" className={DELEGATION_OPEN ? "button" : undefined}>
            {DELEGATION_OPEN ? "Pledge rewards" : "Your pledge"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-inner">
        <span>Independent of the coin&rsquo;s creators. Not financial advice.</span>
        <span className="footer-links">
          <a href={links.x}>X</a>
          <a href={links.github}>Source code</a>
          <Link href="/security">Security</Link>
          <a href={links.stonkfun}>$PENIS on stonk.fun</a>
        </span>
      </div>
    </footer>
  );
}
