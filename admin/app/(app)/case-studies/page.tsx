import { ContentTypeListPage, type ListSearchParams } from '../ContentTypeListPage';

export const dynamic = 'force-dynamic';

// The Case Studies Studio App's surface — the content type existed in the
// schema since Folio (type: case_study), deliberately not user-facing until
// this app. Same shared list component as Pages/Posts: full canvas/builder,
// SEO, and publish flow inherited from the Content engine.
export default async function CaseStudiesPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return (
    <ContentTypeListPage
      type="case_study"
      label="Case Studies"
      singularLabel="Case Study"
      sub="Portfolio pieces — the work, the story, the results."
      searchPlaceholder="Search case studies…"
      emptyTitle="No case studies yet"
      emptySub="Publish your first piece of work to start the portfolio."
      searchParams={await searchParams}
    />
  );
}
