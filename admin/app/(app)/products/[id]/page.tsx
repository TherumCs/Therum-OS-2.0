import { apiGet } from '../../../../lib/api';
import { type EditorProduct } from './ProductEditor';
import { ProductStudio } from './ProductStudio';

export const dynamic = 'force-dynamic';

interface Term {
  id: string;
  name: string;
  slug: string;
}

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories, tags, milieus] = await Promise.all([
    apiGet<EditorProduct>(`/api/products/${id}`),
    apiGet<Term[]>('/api/catalog/categories'),
    apiGet<Term[]>('/api/catalog/tags'),
    // Groups are only needed for a restricted product, but fetching them here
    // keeps the panel from flashing empty the moment it is switched on.
    apiGet<{ id: string; name: string }[]>('/api/milieus').catch(() => []),
  ]);
  return <ProductStudio initial={product} allCategories={categories} allTags={tags} allMilieus={milieus} />;
}
