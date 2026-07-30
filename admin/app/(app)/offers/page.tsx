import { redirect } from 'next/navigation';

// Offers is a tab of Promotions now — it sits alongside Coupons, which is
// what an offer actually sends.
export default function MovedToPromotions(): never {
  redirect('/promotions');
}
