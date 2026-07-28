import { redirect } from 'next/navigation';
import { APPEARANCE_SECTIONS } from '../../../lib/appearanceSections';

// Bare /appearance has no content of its own — the rail's first section is
// the landing screen, same as /settings.
export default function AppearanceIndex() {
  redirect(`/appearance/${APPEARANCE_SECTIONS[0]!.id}`);
}
