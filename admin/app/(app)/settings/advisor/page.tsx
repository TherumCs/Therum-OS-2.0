import { AdvisorClient } from './AdvisorClient';

export const dynamic = 'force-dynamic';

// The scan runs on demand rather than on page load: it queries Postgres, hits
// Redis and makes an HTTP request to our own server, which is not work to do
// every time someone clicks through Settings.
export default function AdvisorPage() {
  return <AdvisorClient />;
}
