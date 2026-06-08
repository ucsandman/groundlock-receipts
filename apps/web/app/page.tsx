import Image from "next/image";
import { VerifierWidget } from "../components/VerifierWidget";
import {
  CacheMechanism,
  MarketingNav,
  OssPresence,
  PlainProofBoundary,
  Pricing,
  PublicGood,
  ResolverCacheProof,
  ThreatModelSummary,
  VerificationBoundary,
} from "../components/MarketingSections";

export default function Home() {
  return (
    <main className="min-h-screen text-[var(--ink)]">
      <MarketingNav />
      <section className="relative overflow-hidden border-b border-[var(--line)] bg-[var(--surface)]">
        <Image
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-multiply"
          fill
          priority
          sizes="100vw"
          src="/groundlock-receipt-desk.png"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--surface)_0%,rgb(243_247_236_/_0.94)_34%,rgb(243_247_236_/_0.74)_100%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start lg:py-12">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase text-[var(--brass)]">GroundLock Receipts</p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl font-semibold leading-none md:text-7xl">
              Store the proof in DNS cache.
            </h1>
            <p className="mt-5 text-xl font-bold leading-8">
              DNSFS-style receipt storage for AI-generated business messages.
            </p>
          </div>

          <VerifierWidget className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-1" />

          <div className="max-w-2xl lg:col-start-1">
            <p className="mt-5 max-w-xl leading-7 text-[var(--muted-ink)]">
              The message is checked, the receipt is signed, and the proof is sliced into DNS TXT chunks. Verifiers
              reconstruct it from resolver-cache answers instead of trusting a vendor-hosted screenshot.
            </p>
            <div className="mt-7 grid max-w-xl grid-cols-1 border border-[var(--line)] bg-[var(--paper)] md:grid-cols-3">
              {["Public verify is free", "DNS cache is storage", "Receipts fail closed"].map((item) => (
                <div className="border-b border-[var(--line)] p-3 text-sm font-bold last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0" key={item}>
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3 text-sm font-bold">
              <a className="border border-[var(--line)] bg-[var(--acid)] px-4 py-3" href="#verify">
                Run sample
              </a>
              <a className="border border-[var(--line)] bg-[var(--paper)] px-4 py-3" href="/threat-model">
                What it does not prove
              </a>
            </div>
          </div>
        </div>
      </section>

      <PlainProofBoundary />
      <ResolverCacheProof />
      <CacheMechanism />
      <VerificationBoundary />
      <PublicGood />
      <ThreatModelSummary />
      <Pricing />
      <OssPresence />
    </main>
  );
}
