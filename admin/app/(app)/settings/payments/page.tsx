import { redirect } from 'next/navigation';

// Moved to the Counter section in the sidebar — see settings/counter/page.tsx.
export default function MovedToPayments(): never {
  redirect('/payments');
}
