import Link from "next/link";
import { SolidLogo } from "@/components/Logo";
import { ProjectsNavLink } from "@/components/ProjectsList";
import { links } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <Link href="/" className="brand">
          <SolidLogo className="brand-mark" />
          <span>The $PENIS Endowment</span>
        </Link>
        <nav aria-label="Primary" className="nav">
          <Link href="/#how">How it works</Link>
          <Link href="/thesis">Thesis</Link>
          <Link href="/build">For projects</Link>
          <ProjectsNavLink />
          <Link href="/#questions">Questions</Link>
          <Link href="/contributions" className="button">
            Contributions
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
          <Link href="/build">For projects</Link>
          <a href="/endowment-guide.md">Historical guide</a>
          <a href={links.stonkfun}>$PENIS on stonk.fun</a>
        </span>
      </div>
    </footer>
  );
}
