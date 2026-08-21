import { ContentTypeListPage, type ListSearchParams } from '../ContentTypeListPage';

export const dynamic = 'force-dynamic';

export default async function PagesPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return (
    <ContentTypeListPage
      type="page"
      label="Pages"
      singularLabel="Page"
      sub="Standalone pages — homepage, services, about, etc."
      searchPlaceholder="Search pages…"
      emptyTitle="No pages yet"
      emptySub="Create your first page to get started."
      showImport
      searchParams={await searchParams}
    />
  );
}
