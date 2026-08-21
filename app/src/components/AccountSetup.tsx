// The first choice at signup: Personal or Commercial. Personal is a normal
// account for your own work. Commercial sets up a company umbrella with an
// admin, members you add by email, and a plan priced by how many people use it.
// Everything about the app is identical either way; commercial just adds the
// admin controls and the shared, admin-owned stack.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { COMMERCIAL_TIERS, priceLabel, tierForSeats } from '../lib/plans.js';
import { BrandMark } from './BrandMark.js';

export function AccountSetup() {
  const { setupAccount } = useApp();
  const [choice, setChoice] = useState<'none' | 'commercial'>('none');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState(1);

  const tier = tierForSeats(seats);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="shell-main">
      <div className="screen">
        <div className="screen-inner" style={{ paddingTop: 'calc(40px + var(--safe-top))' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span className="brand-lockup">
              <BrandMark size={30} />
              <span className="wordmark" style={{ fontSize: 22 }}>
                <span className="accent">OS</span> Code
              </span>
            </span>
            <h1 style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
              How will you use OS Code?
            </h1>
            <p className="lead" style={{ marginTop: 8 }}>
              Pick one to start. You can change this later in Settings.
            </p>
          </div>

          {choice === 'none' ? (
            <>
              <div className="card account-card">
                <h3>Personal</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  For your own work, your models, your keys. Free to chat. Unlock the coding agent
                  and the Marketplace with Personal, $20 a year.
                </div>
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  onClick={() => void setupAccount({ type: 'personal' })}
                >
                  Use it personally
                </button>
              </div>

              <div className="card account-card">
                <h3>Commercial</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  For a team. You become the admin: add people by email, and own the shared stack
                  and where everything lives. Priced by how many people use it.
                </div>
                <div className="plan-grid">
                  {COMMERCIAL_TIERS.map((t) => (
                    <div className="plan-chip" key={t.id}>
                      {t.blurb}
                    </div>
                  ))}
                </div>
                <button
                  className="btn ghost"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={() => setChoice('commercial')}
                >
                  Set up a company
                </button>
              </div>
            </>
          ) : (
            <div className="card account-card selected">
              <h3>Set up your company</h3>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Company name</label>
                <input
                  placeholder="e.g. Acme Inc"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Your email (you are the first admin)</label>
                <input
                  type="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label>How many people will use it?</label>
                <input
                  type="number"
                  min={1}
                  value={seats}
                  onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div className="card" style={{ background: 'var(--local-soft)', marginTop: 4 }}>
                <div className="card-row">
                  <div className="grow">
                    <h3 style={{ color: 'var(--local)' }}>{tier.name} plan</h3>
                    <div className="sub">{tier.blurb}</div>
                  </div>
                  <span className="pill price">{priceLabel(tier)}</span>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                Billing is not live in this build. You are setting up the company and its plan; no
                card is asked for and nothing is charged.
              </p>
              <div className="sheet-actions">
                <button
                  className="btn primary"
                  disabled={!emailValid}
                  onClick={() =>
                    void setupAccount({
                      type: 'commercial',
                      ownerEmail: email.trim(),
                      orgName: orgName.trim() || undefined,
                      seatCount: seats,
                    })
                  }
                >
                  Create company account
                </button>
                <button className="btn quiet" onClick={() => setChoice('none')}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
