import { apiGet } from '../../../lib/api';
import { CustomersClient, type CustomerRow, type GroupOption } from './CustomersClient';

export const dynamic = 'force-dynamic';

interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}
interface MilieuRow {
  id: string;
  name: string;
}

// Counter › Customers — everyone with an account or an order (including the
// WordPress import). Edit display/first/last names and set which Milieus
// (groups) they belong to; group discounts follow automatically.
export default async function CustomersPage() {
  let customers: CustomerRow[] = [];
  let groups: GroupOption[] = [];
  let loadError = false;
  try {
    const [c, m] = await Promise.all([
      apiGet<Paged<CustomerRow>>('/api/customers?limit=100'),
      apiGet<MilieuRow[]>('/api/milieus'),
    ]);
    customers = c.items;
    groups = m.map((x) => ({ id: x.id, name: x.name }));
  } catch {
    loadError = true;
  }

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {customers.length} {customers.length === 1 ? 'CUSTOMER' : 'CUSTOMERS'} · {groups.length} GROUPS
          </div>
          <h1 className="th-lp-title">Customers</h1>
          <p className="th-lp-sub">
            Everyone who has an account or has ordered — including the imported history. Edit a display name or the
            first/last name on file, and set which groups (Milieus) they belong to. Group discounts apply
            automatically; card details are never shown here.
          </p>
        </div>
      </div>

      <CustomersClient initial={customers} groups={groups} loadError={loadError} />
    </section>
  );
}
