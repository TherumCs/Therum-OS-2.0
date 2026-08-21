import { ContentTypeListPage, type ListSearchParams } from '../ContentTypeListPage';

export const dynamic = 'force-dynamic';

export default async function PostsPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return (
    <ContentTypeListPage
      type="post"
      label="Posts"
      singularLabel="Post"
      sub="Blog posts and articles."
      searchPlaceholder="Search posts…"
      emptyTitle="No posts yet"
      emptySub="Create your first post to get started."
      searchParams={await searchParams}
    />
  );
}
