// Admin: the company umbrella. Here the admin adds people by email, grants or
// revokes admin, sets the plan by headcount, and owns what members cannot touch
// (the shared stack and where models and repos live). Members get the whole app
// as their own, with the stack shown read-only. Everyone's crew and projects
// stay personal.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { tierById, priceLabel } from '../lib/plans.js';
import { BackBar } from '../components/BackBar.js';

export function AdminScreen() {
  const {
    settings,
    addMember,
    removeMember,
    setMemberRole,
    setSeatCount,
    setPreviewAsMember,
    showToast,
  } = useApp();

  const account = settings.account;
  const org = account?.org;
  const [email, setEmail] = useState('');
  const [seatEdit, setSeatEdit] = useState(false);
  const [seats, setSeats] = useState(org?.seatCount ?? 1);

  if (!org) {
    return (
      <div className="screen">
        <BackBar title="Admin" />
        <div className="screen-inner">
          <h1>Admin</h1>
          <p className="lead">This is a personal account. Admin controls are for company accounts.</p>
        </div>
      </div>
    );
  }

  const tier = tierById(org.tierId);
  const previewing = Boolean(account?.previewAsMember);

  const add = async () => {
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      showToast('Enter a valid email.');
      return;
    }
    await addMember(clean);
    setEmail('');
    showToast(`${clean} can now sign in under ${org.name}.`);
  };

  return (
    <div className="screen">
      <BackBar title="Admin" />
      <div className="screen-inner">
        <h1>{org.name}</h1>
        <p className="lead">
          You own the company umbrella. Add people by email, decide who else is an admin, and own
          the shared stack and where everything lives. Everything else is each person's own.
        </p>

        {/* Plan + seats. */}
        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>{tier.name} plan</h3>
              <div className="sub">
                {org.seatCount} {org.seatCount === 1 ? 'seat' : 'seats'} declared. {tier.blurb}
              </div>
            </div>
            <span className="pill local">{priceLabel(tier)}</span>
            <button
              className="btn ghost"
              style={{ padding: '8px 14px' }}
              onClick={() => {
                setSeats(org.seatCount);
                setSeatEdit((v) => !v);
              }}
            >
              {seatEdit ? 'Close' : 'Change'}
            </button>
          </div>
          {seatEdit ? (
            <div style={{ marginTop: 12 }}>
              <div className="field">
                <label>How many people will use it?</label>
                <input
                  type="number"
                  min={1}
                  value={seats}
                  onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <button
                className="btn primary"
                style={{ width: '100%' }}
                onClick={async () => {
                  await setSeatCount(seats);
                  setSeatEdit(false);
                  showToast('Plan updated to match your headcount.');
                }}
              >
                Save headcount
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                Billing is not live in this build. Nothing is charged.
              </p>
            </div>
          ) : null}
        </div>

        {/* Member roster. */}
        <h3 style={{ margin: '18px 0 10px' }}>People</h3>
        <div className="card">
          <div className="field" style={{ margin: 0 }}>
            <label>Add someone by email</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void add()}
              />
              <button className="btn primary" style={{ padding: '11px 16px' }} onClick={() => void add()}>
                Add
              </button>
            </div>
          </div>
        </div>

        {org.members.length === 0 ? (
          <p className="hint">No one added yet. Your own email becomes the first admin.</p>
        ) : (
          org.members.map((m) => {
            const isSelf = m.email === account?.selfEmail;
            return (
              <div className="card" key={m.id}>
                <div className="card-row">
                  <div className="grow">
                    <h3>
                      {m.email}
                      {isSelf ? <span className="sub"> (you)</span> : null}
                    </h3>
                    <div className="sub">{m.role === 'admin' ? 'Admin' : 'Member'}</div>
                  </div>
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={() =>
                      void setMemberRole(m.id, m.role === 'admin' ? 'member' : 'admin')
                    }
                  >
                    {m.role === 'admin' ? 'Make member' : 'Make admin'}
                  </button>
                  {isSelf ? null : (
                    <button
                      className="btn quiet"
                      style={{ padding: '8px 14px' }}
                      onClick={() => void removeMember(m.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* What members can and cannot do. */}
        <div className="divider" />
        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Preview the member view</h3>
              <div className="sub">
                See the app as a member does: the stack read-only, no bench, no controls. Their
                chats, projects, and crew stay their own.
              </div>
            </div>
            <button
              className={`btn ${previewing ? 'primary' : 'ghost'}`}
              style={{ padding: '8px 14px' }}
              onClick={() => void setPreviewAsMember(!previewing)}
            >
              {previewing ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        <p className="hint">
          Roles here are enforced in the app for now. When accounts move to the cloud, the server
          enforces who is an admin and who can change the stack, so this cannot be worked around.
        </p>
      </div>
    </div>
  );
}
