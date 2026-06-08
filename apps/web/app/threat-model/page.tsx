import { MarketingNav, OssPresence, ThreatModelDetail } from "../../components/MarketingSections";

export const metadata = {
  title: "Threat model - GroundLock Receipts",
  description: "What GroundLock Receipts prove, what they do not prove, and why the verifier fails closed.",
};

export default function ThreatModelPage() {
  return (
    <main className="min-h-screen text-[var(--ink)]">
      <MarketingNav />
      <ThreatModelDetail />
      <OssPresence />
    </main>
  );
}
