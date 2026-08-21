import { revalidatePath } from 'next/cache';
import { apiGet, apiSend } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { money, fmtDate } from '../format';
import { WoopayDisputeActions } from '../WoopayDisputeActions';

export const dynamic = 'force-dynamic';

// Counter › Payments › Disputes — chargebacks and inquiries. On the WooPayments
// engine (top) evidence is built and submitted here, and a dispute can be
// closed (loss accepted), without ever opening a WordPress admin. The
// direct-Stripe list (below) stays a read-only running list and respond-by
// clock — evidence for that account is filed in the Stripe dashboard.

interface Dispute {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  created: number;
  evidenceDueBy: number | null;
  hasEvidence: boolean;
  chargeId: string | null;
}
interface Resp {
  connected: boolean;
  disputes: Dispute[];
  error?: string;
}
// The WooPayments dispute adds the two flags that decide which actions are
// live: whether evidence has already been submitted, and whether it is closed.
interface WoopayDispute extends Dispute {
  orderNumber: string | null;
  orderId: string | null;
  submitted: boolean;
  closed: boolean;
}
interface WoopayDisputesResp {
  connected: boolean;
  disputes: WoopayDispute[];
  error?: string;
}

// Server Actions: submit/save evidence, or close the dispute. Both return a
// serialisable { error } for the island to render rather than throwing.
async function woopayRespondDispute(
  id: string,
  evidence: Record<string, string>,
  submit: boolean,
): Promise<{ error?: string } | void> {
  'use server';
  try {
    await apiSend('POST', `/api/counter/payments/woopay/disputes/${encodeURIComponent(id)}`, { evidence, submit });
    revalidatePath('/payments/disputes');
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save the response.' };
  }
}

async function woopayCloseDispute(id: string): Promise<{ error?: string } | void> {
  'use server';
  try {
    await apiSend('POST', `/api/counter/payments/woopay/disputes/${encodeURIComponent(id)}/close`, {});
    revalidatePath('/payments/disputes');
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not close the dispute.' };
  }
}

export default async function DisputesPage() {
  const [wd, r] = await Promise.all([
    apiGet<WoopayDisputesResp>('/api/counter/payments/woopay/disputes?limit=50').catch(
      (): WoopayDisputesResp => ({ connected: false, disputes: [] }),
    ),
    apiGet<Resp>('/api/counter/payments/disputes?limit=50').catch((): Resp => ({ connected: false, disputes: [] })),
  ]);

  return (
    <div>
      {/* WooPayments disputes — the engine account, with respond/close actions. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">WooPayments disputes &amp; chargebacks</div>
        <p className="th-about-sub">
          When a cardholder disputes a charge the amount is held. Build and submit your evidence before the respond-by
          date, or accept the loss to close the case — all from here.
        </p>
        {!wd.connected ? (
          <p className="muted">{wd.error ?? 'WooPayments is not connected yet — connect it from the Overview tab.'}</p>
        ) : wd.disputes.length === 0 ? (
          <p className="muted">No disputes — a clean record, nothing to respond to.</p>
        ) : (
          <>
            {wd.error && <p className="muted">{wd.error}</p>}
            <div className="pay-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="pay-num">Amount</th>
                    <th>Order / reason</th>
                    <th>Status</th>
                    <th>Respond by</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {wd.disputes.map((d) => (
                    <tr key={d.id}>
                      <td className="pay-num">{money(d.amount)}</td>
                      <td>
                        {d.orderNumber && d.orderId ? (
                          <a className="pay-orderlink" href={`${BASE_PATH}/orders/${d.orderId}`}>
                            {d.orderNumber}
                          </a>
                        ) : (
                          <span style={{ textTransform: 'capitalize' }}>{d.reason.replace(/_/g, ' ')}</span>
                        )}
                      </td>
                      <td>
                        <span className="th-about-badge">{d.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td>{fmtDate(d.evidenceDueBy)}</td>
                      <td>
                        <WoopayDisputeActions
                          disputeId={d.id}
                          closed={d.closed}
                          submitted={d.submitted}
                          onRespond={woopayRespondDispute}
                          onClose={woopayCloseDispute}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Direct-Stripe disputes — the Nexus-key account, read-only. */}
      {r.connected ? (
        <div className="card">
          <div className="l">Disputes &amp; chargebacks (direct Stripe)</div>
          <p className="th-about-sub">
            When a cardholder disputes a charge the amount is held. You have until the respond-by date to submit evidence
            in your Stripe dashboard.
          </p>
          {r.error && <p className="muted">{r.error}</p>}
          {r.disputes.length === 0 ? (
            <p className="muted">No disputes — a clean record, nothing to respond to.</p>
          ) : (
            <div className="pay-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="pay-num">Amount</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Respond by</th>
                    <th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {r.disputes.map((d) => (
                    <tr key={d.id}>
                      <td className="pay-num">{money(d.amount)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{d.reason.replace(/_/g, ' ')}</td>
                      <td>
                        <span className="th-about-badge">{d.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td>{fmtDate(d.evidenceDueBy)}</td>
                      <td>{fmtDate(d.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
