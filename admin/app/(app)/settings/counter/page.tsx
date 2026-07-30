import { redirect } from 'next/navigation';

// Moved to the Counter section in the sidebar. Redirecting rather than
// deleting keeps every bookmark and in-app link from before the move working.
export default function MovedToCustomization(): never {
  redirect('/customization');
}
