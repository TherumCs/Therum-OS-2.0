import { ServerClient } from './ServerClient';

export const dynamic = 'force-dynamic';

// The panel half of the pair: Advisor says what is wrong, Server does something
// about it. Split deliberately — reading the box and changing it are different
// permissions to think about, even though both sit behind manage-settings.
export default function ServerPage() {
  return <ServerClient />;
}
