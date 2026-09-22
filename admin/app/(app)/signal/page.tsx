import { apiGet } from '../../../lib/api';
import { SignalClient, type SignalStatus } from './SignalClient';

export const dynamic = 'force-dynamic';

// Signal — Meta Pixel + Conversions API. A Studio app: enable it under
// "From the Studio" and it appears in the sidebar.
export default async function SignalPage() {
  let status: SignalStatus | null = null;
  try {
    status = await apiGet<SignalStatus>('/api/signal');
  } catch {
    status = null;
  }
  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {status?.conversionsApi ? 'PIXEL + CONVERSIONS API LIVE' : status?.pixel ? 'PIXEL LIVE · SERVER EVENTS OFF' : 'NOT SENDING'}
          </div>
          <h1 className="th-lp-title">Signal</h1>
          <p className="th-lp-sub">
            Tells Meta who buys, so ads can find more of them. The pixel reports what shoppers do in the browser; the Conversions API reports each paid order from the
            server, so a sale still counts when an ad blocker or iPhone privacy stops the pixel.
          </p>
        </div>
      </div>
      {status ? <SignalClient initial={status} /> : <div className="notice">Could not load Signal settings.</div>}
    </section>
  );
}
