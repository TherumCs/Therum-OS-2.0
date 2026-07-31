import { CatalogTabs } from '../CatalogTabs';
import { ImportClient } from './ImportClient';
import { PrintfulSync } from './PrintfulSync';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return (
    <section>
      <h1>Product Catalog</h1>
      <CatalogTabs current="import" />
      <p className="th-hint" style={{ marginTop: 16, maxWidth: '68ch' }}>
        Most products arrive from a connected provider — sync those below. Or import a catalogue from anywhere. The columns do not have to be named ours — read the file, then say what
        each of its columns means. Prices, nested categories (<code>snacks/japan</code>), tags and images all come
        across, and nothing is written until you press Import.
      </p>
      <PrintfulSync />
      <ImportClient />
    </section>
  );
}
