import { redirect } from 'next/navigation';

// Payments grew into the store's whole connection picture — who takes the
// money, who ships, where products sync from. See connections/page.tsx.
export default function MovedToConnections(): never {
  redirect('/connections');
}
