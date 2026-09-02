export default function FoundationPage() {
  return (
    <main className="shell-main">
      <section className="hero-card" aria-labelledby="foundation-title">
        <p className="eyebrow">Dar Tech OS · Identity foundation</p>
        <h1 id="foundation-title">Invitation-only access, built for controlled onboarding.</h1>
        <p className="lede">
          Employee access begins with an authorized invitation and a verified provider identity.
          Application sessions remain deferred to the next separately authorized security ticket.
        </p>
        <nav className="hero-actions" aria-label="Invitation routes">
          <a className="button primary" href="/admin/invitations">Manage invitations</a>
          <a className="button secondary" href="/onboarding">Open onboarding</a>
        </nav>
      </section>
    </main>
  );
}
