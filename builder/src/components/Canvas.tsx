import { useEffect, useState, type MouseEvent, type ReactNode, type CSSProperties } from 'react';
import { useCanvas } from '../store/useCanvas.js';
import { REGISTRY } from '../lib/element-registry.js';
import type { CanvasNode } from '../lib/builder-types.js';
import { fetchProducts, formatPrice, type ApiProduct } from '../lib/api.js';

function ProductList({ limit, columns }: { limit: number; columns: number }): ReactNode {
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchProducts(limit)
      .then((p) => live && setProducts(p))
      .catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [limit]);

  if (err) return <div className="cv-note">Product list — API offline ({err})</div>;
  if (!products.length) return <div className="cv-note">Product list — no products yet (start the API + seed)</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 'var(--th-space-16)' }}>
      {products.slice(0, limit).map((p) => (
        <div key={p.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          <img src={p.image ?? 'https://placehold.co/400x240'} alt={p.name} style={{ width: '100%', height: 130, objectFit: 'cover' }} />
          <div style={{ padding: 'var(--th-space-12)' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
            <div style={{ color: 'var(--th-accent)', fontWeight: 600, marginTop: 'var(--th-space-4)' }}>{formatPrice(p.variants[0]?.price ?? 0)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function NodeView({ node }: { node: CanvasNode }): ReactNode {
  const selectedId = useCanvas((s) => s.selectedId);
  const select = useCanvas((s) => s.select);
  const p = node.props;
  const selected = selectedId === node.id;
  const onClick = (e: MouseEvent): void => {
    e.stopPropagation();
    select(node.id);
  };
  const wrap = (inner: ReactNode): ReactNode => (
    <div className={'cv-node' + (selected ? ' cv-selected' : '')} onClick={onClick} data-type={node.type}>
      <span className="cv-tag">{REGISTRY[node.type].label}</span>
      {inner}
    </div>
  );
  const kids = node.children.map((c) => <NodeView key={c.id} node={c} />);

  switch (node.type) {
    case 'section':
      return wrap(
        <section style={{ background: String(p.background), padding: Number(p.padding) || 0 }}>
          <div style={{ maxWidth: Number(p.maxWidth) || 1100, margin: '0 auto' }}>
            {kids}
            {!node.children.length && <div className="cv-empty">Empty section — add elements</div>}
          </div>
        </section>,
      );
    case 'container':
      return wrap(
        <div style={{ display: 'flex', flexDirection: p.direction === 'row' ? 'row' : 'column', gap: Number(p.gap) || 0, alignItems: String(p.align) as CSSProperties['alignItems'] }}>
          {kids}
          {!node.children.length && <div className="cv-empty">Empty container</div>}
        </div>,
      );
    case 'heading': {
      const Lvl = (['h1', 'h2', 'h3'].includes(String(p.level)) ? p.level : 'h2') as 'h1' | 'h2' | 'h3';
      return wrap(<Lvl style={{ color: String(p.color), textAlign: String(p.align) as CSSProperties['textAlign'], margin: 0 }}>{String(p.text)}</Lvl>);
    }
    case 'text':
      return wrap(<p style={{ color: String(p.color), fontSize: Number(p.size) || 16, margin: 0, lineHeight: 1.6 }}>{String(p.content)}</p>);
    case 'button':
      return wrap(
        <a href={String(p.href)} onClick={(e) => e.preventDefault()} style={{ display: 'inline-block', background: String(p.background), color: String(p.color), padding: 'var(--th-space-12) var(--th-space-20)', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}>
          {String(p.label)}
        </a>,
      );
    case 'image':
      return wrap(<img src={String(p.src)} alt={String(p.alt)} style={{ width: Number(p.width) || 600, maxWidth: '100%', height: 'auto', borderRadius: 8 }} />);
    case 'productList':
      return wrap(<ProductList limit={Number(p.limit) || 6} columns={Number(p.columns) || 3} />);
  }
}

export function Canvas(): ReactNode {
  const tree = useCanvas((s) => s.tree);
  const select = useCanvas((s) => s.select);
  return (
    <div className="cv-canvas" onClick={() => select(null)}>
      <NodeView node={tree} />
    </div>
  );
}
