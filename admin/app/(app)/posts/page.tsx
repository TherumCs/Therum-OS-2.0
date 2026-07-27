import { ContentTypeListPage } from '../ContentTypeListPage';

export const dynamic = 'force-dynamic';

export default function PostsPage() {
  return (
    <ContentTypeListPage
      type="post"
      label="Posts"
      singularLabel="Post"
      sub="Blog posts and articles."
      searchPlaceholder="Search posts…"
      emptyTitle="No posts yet"
      emptySub="Create your first post to get started."
    />
  );
}
