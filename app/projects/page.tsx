import type { Metadata } from "next";
import Link from "next/link";
import { ProjectsList } from "@/components/ProjectsList";

export const metadata: Metadata = {
  title: "Projects",
  description: "Every endowment running on the shared, open-source endowment contract.",
};

export default function Projects() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">One contract, many endowments.</h1>
          <p className="lede">
            Every project here runs on the same open-source contract as the $PENIS Endowment, with the same rules and
            the same guarantees.
          </p>
        </div>
      </section>
      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Endowments</h2>
          <div className="row-body">
            <ProjectsList />
            <p className="muted small">
              Want one for your coin? <Link href="/build">See how to start an endowment</Link>.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
