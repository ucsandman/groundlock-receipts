const githubUrl = "https://github.com/ucsandman/groundlock-receipts";

const threatItems = [
  {
    title: "Canonicalized hash limits",
    body:
      "A receipt binds one GroundLock canonicalized text hash. Attachments, rendering paths, and raw file bytes must be verified separately.",
  },
  {
    title: "Signer accountability",
    body:
      "GroundLock proves which signer key issued a PASS or BLOCK receipt. It does not excuse the publisher from bad source data, weak review, or misconfigured policy.",
  },
  {
    title: "DNS cache dependency",
    body:
      "DNS resolver caches are the storage and amplification layer. Verification depends on TXT manifest/chunk records that can be authenticated by the resolver path used for verification.",
  },
  {
    title: "Revocation",
    body:
      "Status records can revoke a key or receipt after issuance. A revoked receipt is shown as REVOKED even if the old signature still verifies.",
  },
  {
    title: "Privacy",
    body:
      "Public verification can reveal the GroundLock content hash being checked. Private lookup modes are for publishers that need status checks without broadcasting every claim.",
  },
  {
    title: "Not truth adjudication",
    body:
      "A PASS means the message matched the publisher's grounded source rules. It does not independently prove the prose is true, complete, or legally sufficient.",
  },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color-mix(in_oklch,var(--paper)_92%,transparent)] backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 md:px-8">
        <a className="font-[family-name:var(--font-display)] text-xl font-semibold" href="/">
          GroundLock Receipts
        </a>
        <div className="hidden items-center gap-5 text-sm font-semibold text-[var(--muted-ink)] md:flex">
          <a className="hover:text-[var(--ink)]" href="/#verify">
            Verify
          </a>
          <a className="hover:text-[var(--ink)]" href="/#how">
            How it works
          </a>
          <a className="hover:text-[var(--ink)]" href="/threat-model">
            Threat model
          </a>
          <a className="hover:text-[var(--ink)]" href="/#pricing">
            Pricing
          </a>
        </div>
        <a
          className="border border-[var(--line)] bg-[var(--acid)] px-3 py-2 text-sm font-bold text-[var(--ink)]"
          href={githubUrl}
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function HowItWorks() {
  const steps = [
    {
      label: "01",
      title: "Sign the exact message",
      body:
        "Publisher policy checks the proposed AI message against source facts, then signs a PASS or BLOCK receipt for the canonicalized content hash.",
    },
    {
      label: "02",
      title: "Warm DNS cache storage",
      body:
        "The signed receipt is split into TXT-sized manifest and chunk records, then warmed into configured DNS resolver caches.",
    },
    {
      label: "03",
      title: "Reconstruct and verify",
      body:
        "Anyone can paste the hash or file. The verifier reconstructs the receipt from DNS cache chunks, checks hashes and signatures, then reads status.",
    },
  ];

  return (
    <section id="how" className="border-b border-[var(--line)] bg-[var(--paper)]">
      <div className="mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase text-[var(--brass)]">Sign - cache TXT chunks - public verify</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-semibold md:text-5xl">
            DNS resolver caches become the public receipt store.
          </h2>
        </div>
        <ol className="mt-10 grid gap-4 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li
              className="relative border border-[var(--line)] bg-[var(--surface)] p-5"
              key={step.title}
            >
              <div className="mb-8 flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-[var(--muted-ink)]">{step.label}</span>
                {index < steps.length - 1 ? (
                  <span className="hidden font-mono text-xl font-bold text-[var(--acid-strong)] lg:block">-&gt;</span>
                ) : null}
              </div>
              <h3 className="text-xl font-bold">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ThreatModelSummary() {
  return (
    <section className="border-b border-[var(--line)] bg-[var(--blueprint)]">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 md:px-8 md:py-20 lg:grid-cols-[0.82fr_1.18fr]">
        <div>
          <p className="text-sm font-bold uppercase text-[var(--danger)]">Threat model</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-semibold md:text-5xl">
            GroundLock is narrow on purpose.
          </h2>
          <p className="mt-5 max-w-xl leading-7 text-[var(--muted-ink)]">
            It is a non-fabrication receipt system, not an oracle. The verifier should fail closed and explain why
            it cannot prove a message.
          </p>
          <a
            className="mt-6 inline-block border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm font-bold"
            href="/threat-model"
          >
            Read the threat model
          </a>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {threatItems.slice(0, 4).map((item) => (
            <article className="border border-[var(--line)] bg-[var(--paper)] p-4" key={item.title}>
              <h3 className="font-bold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Pricing() {
  const tiers = [
    {
      name: "Public verify",
      price: "$0",
      body: "Paste text content or a GroundLock hash, no account, no sales form, no usage gate.",
      emphasis: true,
    },
    {
      name: "Publisher",
      price: "Usage-based",
      body: "Issue signed PASS/BLOCK receipts, warm DNS cache chunks, and manage revocation records.",
      emphasis: false,
    },
    {
      name: "Regulated teams",
      price: "Contract",
      body: "Policy review, private status lookups, key rotation process, and audit-ready evidence trails.",
      emphasis: false,
    },
  ];

  return (
    <section id="pricing" className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-20">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-bold uppercase text-[var(--brass)]">Pricing</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-semibold md:text-5xl">
              Verification stays public and free.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-[var(--muted-ink)]">
            Charging publishers should never make a counterparty pay to check whether a receipt exists.
          </p>
        </div>
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {tiers.map((tier) => (
            <article
              className={`border border-[var(--line)] p-5 ${
                tier.emphasis ? "bg-[var(--acid)]" : "bg-[var(--paper)]"
              }`}
              key={tier.name}
            >
              <h3 className="text-xl font-bold">{tier.name}</h3>
              <p className="mt-4 font-[family-name:var(--font-display)] text-4xl font-semibold">{tier.price}</p>
              <p className="mt-4 text-sm leading-6 text-[color-mix(in_oklch,var(--ink)_78%,transparent)]">
                {tier.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function OssPresence() {
  return (
    <section className="bg-[var(--ink)] text-[var(--paper)]">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-12 md:grid-cols-[1fr_auto] md:items-center md:px-8">
        <div>
          <p className="text-sm font-bold uppercase text-[var(--acid)]">Open source</p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold">
            Inspect the receipt code before trusting the receipt.
          </h2>
        </div>
        <a
          className="border border-[var(--acid)] px-5 py-3 text-sm font-bold text-[var(--acid)]"
          href={githubUrl}
          rel="noreferrer"
          target="_blank"
        >
          github.com/ucsandman/groundlock-receipts
        </a>
      </div>
    </section>
  );
}

export function ThreatModelDetail() {
  return (
    <section className="bg-[var(--paper)]">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8 md:py-16">
        <p className="text-sm font-bold uppercase text-[var(--danger)]">What it proves and what it refuses to prove</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl font-semibold md:text-7xl">
          Threat model
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[var(--muted-ink)]">
          GroundLock Receipts are built for canonicalized-message accountability. They deliberately avoid broader claims that
          the cryptography and DNS path cannot justify.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {threatItems.map((item) => (
            <article className="border border-[var(--line)] bg-[var(--surface)] p-5" key={item.title}>
              <h2 className="text-2xl font-bold">{item.title}</h2>
              <p className="mt-3 leading-7 text-[var(--muted-ink)]">{item.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-10 border border-[var(--line)] bg-[var(--acid)] p-5">
          <h2 className="text-2xl font-bold">Verifier posture</h2>
          <p className="mt-3 max-w-3xl leading-7">
            PASS is only available when every required link verifies. Missing DNS cache chunks,
            malformed signatures, revoked status, or unsupported inputs must produce BLOCK, REVOKED, or UNVERIFIABLE
            rather than a softened success. That is the fail closed boundary.
          </p>
        </div>
      </div>
    </section>
  );
}
