import { apiGet } from '../../../../lib/api';
import { ProductEditor, type EditorProduct } from './ProductEditor';

export const dynamic = 'force-dynamic';

interface Term {
  id: string;
  name: string;
  slug: string;
}

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories, tags] = await Promise.all([
    apiGet<EditorProduct>(`/api/products/${id}`),
    apiGet<Term[]>('/api/catalog/categories'),
    apiGet<Term[]>('/api/catalog/tags'),
  ]);
  return <ProductEditor initial={product} allCategories={categories} allTags={tags} />;
}
