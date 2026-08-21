import Dashboard from '../page';

// /dashboard — canonical dashboard URL. The bare / route renders the same
// view; this exists so the address is spelled out (and so "go to /dashboard"
// works the way the rest of the admin is addressed).
//
// `dynamic` is declared here rather than re-exported from ../page: Next
// parses route-segment config statically and rejects a re-export.
export const dynamic = 'force-dynamic';

export default Dashboard;
