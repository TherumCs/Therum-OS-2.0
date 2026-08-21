'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Per-dispute actions on the WooPayments disputes list: build and submit
// evidence, or accept the loss and close. Evidence is entered here rather than
// in a WordPress admin — the narrative maps to WCPay's `uncategorized_text`
// field, saved as a draft (submit:false) or sent to the cardholder's bank
// (submit:true). Submitting and closing are both irreversible, so each carries
// a confirm. The writes are Server Actions handed down from the page
// (POST /disputes/:id and /disputes/:id/close over the bridge).

export function WoopayDisputeActions({
  disputeId,
  closed,
  submitted,
  onRespond,
  onClose,
}: {
  disputeId: string;
  closed: boolean;
  submitted: boolean;
  onRespond: (id: string, evidence: Record<string, string>, submit: boolean) => Promise<{ error?: string } | void>;
  onClose: (id: string) => Promise<{ error?: string } | void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (closed) {
    return (
      <span className="muted" style={{ fontSize: 'var(--th-fs-xs)' }}>
        Closed
      </span>
    );
  }

  function respond(submit: boolean): void {
    setMsg(null);
    setErr(null);
    const evidence = { uncategorized_text: text.trim() };
    if (!evidence.uncategorized_text) {
      setErr('Add your explanation before saving.');
      return;
    }
    if (submit && !window.confirm("Submit this evidence to the cardholder's bank? It cannot be edited after sending.")) return;
    start(async () => {
      try {
        const res = await onRespond(disputeId, evidence, submit);
        if (res && 'error' in res && res.error) throw new Error(res.error);
        setMsg(submit ? 'Evidence submitted.' : 'Draft saved.');
        router.refresh();
        if (submit) setOpen(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save the response.');
      }
    });
  }

  function close(): void {
    setMsg(null);
    setErr(null);
    if (!window.confirm('Close this dispute and accept the chargeback? The held amount is forfeited.')) return;
    start(async () => {
      try {
        const res = await onClose(disputeId);
        if (res && 'error' in res && res.error) throw new Error(res.error);
        setMsg('Dispute closed.');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not close the dispute.');
      }
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {submitted ? (
          <span className="th-about-badge is-prod">Evidence submitted</span>
        ) : (
          <button type="button" className="th-btn th-btn--xs" disabled={pending} onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : 'Respond'}
          </button>
        )}
        <button type="button" className="th-btn th-btn--xs th-btn--danger" disabled={pending} onClick={close}>
          Accept loss
        </button>
      </div>

      {open && !submitted && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={text}
            disabled={pending}
            placeholder="Explain why this charge is legitimate — order fulfilled, tracking number, customer contact, refund policy shown at checkout…"
            onChange={(e) => setText(e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button type="button" className="th-btn" disabled={pending} onClick={() => respond(false)}>
              {pending ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" className="th-btn th-btn-primary" disabled={pending} onClick={() => respond(true)}>
              {pending ? 'Submitting…' : 'Submit response'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p style={{ color: 'var(--th-accent)', fontSize: 'var(--th-fs-xs)', margin: '6px 0 0' }}>{msg}</p>
      )}
      {err && (
        <p style={{ color: 'var(--th-danger)', fontSize: 'var(--th-fs-xs)', margin: '6px 0 0' }}>{err}</p>
      )}
    </div>
  );
}
