import { redirect } from 'next/navigation';
import { SETTINGS_SECTIONS } from '../../../lib/settingsSections';

// Bare /settings always has a real destination — no "select a section" empty
// state to design around while there's exactly one registered section.
export default function SettingsIndexPage() {
  redirect(`/settings/${SETTINGS_SECTIONS[0].id}`);
}
