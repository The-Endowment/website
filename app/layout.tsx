import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://peniscoin.meme"),
  alternates: { canonical: "/" },
  title: { default: "$PENIS: the coin that pays you to hold", template: "%s · $PENIS" },
  description:
    "Hold your $PENIS. Earn $PUMP. Launched on stonk.fun, with holder rewards and a community goal of a 200 million $PENIS endowment.",
  openGraph: {
    title: "$PENIS: the coin that pays you to hold",
    description: "Hold your $PENIS. Earn $PUMP. Explore the coin on stonk.fun and the community-funded endowment.",
    type: "website",
  },
  twitter: { card: "summary", title: "$PENIS: the coin that pays you to hold" },
  // Pre-launch: keep it out of search until the landlords sign off.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
