'use client';

import { useSettingsForm } from './SettingsForm';

// Wireframes for the storefront card options.
//
// A dropdown reading "Editorial — name, price, colours" tells a merchant the
// words but not the shape, and Bam's complaint was exactly that: "I appreciate
// having a drop down, but I don't know what the fuck this shit is gonna look
// like." So every option draws a rough version of itself, and every option
// that describes a BEHAVIOUR performs it — a "Fade" tile that never fades is a
// label with a picture next to it.
//
// Motion runs on hover or when selected, never on six tiles at once, and is
// dropped under prefers-reduced-motion (see globals.css, .wf-* keyframes).
//
// These are DIAGRAMS, not live cards. Rendering the real storefront card here
// would mean importing storefront CSS into the admin and keeping two copies of
// its markup in step — a chooser only has to be recognisable.

const INK = 'var(--th-ink, #111)';
const MUTE = 'var(--th-muted, #8b8b90)';
const FILL = 'var(--th-surface-2, #ececed)';
const FILL2 = 'var(--th-surface-3, #dedee1)';
const LINE = 'var(--th-line, #e2e2e5)';
const PAPER = 'var(--th-surface, #fff)';

// One canvas for every tile, so the wireframes are comparable at a glance.
const W = 120;
const H = 156;

/** A garment silhouette — enough to read as "a product", not as a grey box. */
function Shirt({ x, y, w, h, tone = MUTE, opacity = 0.34 }: { x: number; y: number; w: number; h: number; tone?: string; opacity?: number }) {
  const cx = x + w / 2;
  const top = y + h * 0.22;
  const bot = y + h * 0.84;
  const sh = w * 0.19;
  return (
    <path
      d={`M${cx - sh * 1.5} ${top}
          L${cx - sh * 0.55} ${top - h * 0.07}
          Q${cx} ${top + h * 0.03} ${cx + sh * 0.55} ${top - h * 0.07}
          L${cx + sh * 1.5} ${top}
          L${cx + sh * 1.9} ${top + h * 0.2}
          L${cx + sh * 1.25} ${top + h * 0.26}
          L${cx + sh * 1.25} ${bot}
          L${cx - sh * 1.25} ${bot}
          L${cx - sh * 1.25} ${top + h * 0.26}
          L${cx - sh * 1.9} ${top + h * 0.2}
          Z`}
      fill={tone}
      opacity={opacity}
    />
  );
}

function Art({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-hidden="true">
      <defs>
        <filter id="wfShadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodOpacity="0.16" />
        </filter>
        <clipPath id="wfThumbClip">
          <rect x="0" y="0" width={W} height="96" rx="3" />
        </clipPath>
      </defs>
      {children}
    </svg>
  );
}

/** The default full-bleed image block, with a product in it. */
function Thumb({ children }: { children?: React.ReactNode }) {
  return (
    <g>
      <rect x="0" y="0" width={W} height="96" rx="3" fill={FILL} />
      <Shirt x={0} y={0} w={W} h={96} />
      <g clipPath="url(#wfThumbClip)">{children}</g>
    </g>
  );
}

const Bar = ({ y, w, o = 1, h = 5, x = 0, className }: { y: number; w: number; o?: number; h?: number; x?: number; className?: string }) => (
  <rect className={className} x={x} y={y} width={w} height={h} rx={h / 2} fill={INK} opacity={o} />
);
const Name = ({ y, w = 68, x = 0 }: { y: number; w?: number; x?: number }) => <Bar x={x} y={y} w={w} o={0.82} h={6} />;
const Price = ({ y, w = 30, x = 0, className }: { y: number; w?: number; x?: number; className?: string }) => (
  <Bar x={x} y={y} w={w} o={0.82} h={6} className={className} />
);
const Sub = ({ y, w = 44, x = 0 }: { y: number; w?: number; x?: number }) => <Bar x={x} y={y} w={w} o={0.3} h={4} />;
const Swatch = ({ x, y, fill = MUTE, o = 0.55 }: { x: number; y: number; fill?: string; o?: number }) => (
  <circle cx={x} cy={y} r="4.5" fill={fill} opacity={o} stroke={LINE} />
);

// ── SHELL ─────────────────────────────────────────────────────────────────
export const SHELL_PREVIEWS: Record<string, React.ReactNode> = {
  bare: (
    <Art>
      <g className="wf-lift">
        <Thumb />
        <Name y={108} />
        <Price y={122} />
      </g>
    </Art>
  ),
  boxed: (
    <Art>
      <g className="wf-lift">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="9" fill={PAPER} stroke={LINE} />
      <rect x="1" y="1" width={W - 2} height="86" rx="8" fill={FILL} />
      <Shirt x={1} y={1} w={W - 2} h={86} />
      <Name x={12} y={100} w={62} />
      <Price x={12} y={114} />
      </g>
    </Art>
  ),
  elevated: (
    <Art>
      <g className="wf-lift">
      <rect x="2" y="2" width={W - 4} height={H - 6} rx="12" fill={PAPER} filter="url(#wfShadow)" />
      <rect x="11" y="11" width={W - 22} height="72" rx="9" fill={FILL} />
      <Shirt x={11} y={11} w={W - 22} h={72} />
      <Name x={11} y={96} w={58} />
      <Price x={11} y={110} />
      </g>
    </Art>
  ),
};

// ── MEDIA ─────────────────────────────────────────────────────────────────
export const MEDIA_PREVIEWS: Record<string, React.ReactNode> = {
  // Auto has no single look, so it is drawn as the two it chooses between:
  // the play badge of a motion card and the arrows of a gallery one.
  auto: (
    <Art>
      <Thumb />
      <g className="wf-pulse" style={{ transformOrigin: '46px 48px' }}>
        <circle cx="46" cy="48" r="13" fill={PAPER} opacity="0.94" />
        <path d="M42.5 42 L52.5 48 L42.5 54 Z" fill={INK} />
      </g>
      <circle cx={W - 30} cy="48" r="9" fill={PAPER} stroke={LINE} />
      <path d={`M${W - 32.5} 44.5 L${W - 28.5} 48 L${W - 32.5} 51.5`} stroke={INK} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  still: (
    <Art>
      <Thumb />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  fade: (
    <Art>
      <Thumb>
        {/* the second photo, cross-fading in — see .wf-fade */}
        <g className="wf-fade">
          <rect x="0" y="0" width={W} height="96" fill={FILL2} />
          <Shirt x={0} y={0} w={W} h={96} tone={INK} opacity={0.3} />
        </g>
      </Thumb>
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  gallery: (
    <Art>
      <Thumb>
        {/* the strip slides one frame across — see .wf-slide */}
        <g className="wf-slide">
          <rect x={W} y="0" width={W} height="96" fill={FILL2} />
          <Shirt x={W} y={0} w={W} h={96} tone={INK} opacity={0.3} />
        </g>
      </Thumb>
      <g>
        <circle cx="13" cy="48" r="9" fill={PAPER} stroke={LINE} />
        <path d="M15.5 44.5 L11.5 48 L15.5 51.5" stroke={INK} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={W - 13} cy="48" r="9" fill={PAPER} stroke={LINE} />
        <path d={`M${W - 15.5} 44.5 L${W - 11.5} 48 L${W - 15.5} 51.5`} stroke={INK} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle className="wf-dot-1" cx="55" cy="86" r="2.6" fill={PAPER} />
      <circle className="wf-dot-2" cx="65" cy="86" r="2.6" fill={PAPER} />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  motion: (
    <Art>
      <Thumb />
      <g className="wf-pulse" style={{ transformOrigin: '60px 48px' }}>
        <circle cx="60" cy="48" r="16" fill={PAPER} opacity="0.94" />
        <path d="M55.5 40 L68 48 L55.5 56 Z" fill={INK} />
      </g>
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
};

// ── PRESET ────────────────────────────────────────────────────────────────
const Pill = ({ x, y, w, h = 11 }: { x: number; y: number; w: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="none" stroke={LINE} />
);
const Chip = ({ x, y, w = 15, h = 13 }: { x: number; y: number; w?: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx="3" fill="none" stroke={LINE} />
);
const Tile = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <g>
    <rect x={x} y={y} width={w} height="22" rx="5" fill={FILL} />
    <rect x={x + 6} y={y + 6} width={w - 20} height="4" rx="2" fill={INK} opacity="0.5" />
    <rect x={x + 6} y={y + 14} width={w - 12} height="3" rx="1.5" fill={INK} opacity="0.22" />
  </g>
);

export const PRESET_PREVIEWS: Record<string, React.ReactNode> = {
  editorial: (
    <Art>
      <Thumb />
      <Name y={106} w={72} />
      <Price y={120} />
      <g className="wf-rise">
        <Swatch x={5} y={140} fill="#1f1f22" o={0.9} />
        <Swatch x={17} y={140} fill="#c8c8cc" />
        <Swatch x={29} y={140} fill="#8a7a5e" />
      </g>
    </Art>
  ),
  retail: (
    <Art>
      <Thumb />
      <Name y={106} w={58} />
      <Price y={106} x={94} w={26} className="wf-rise" />
      <Sub y={120} w={50} />
      <Swatch x={5} y={140} fill="#1f1f22" o={0.9} />
      <Swatch x={17} y={140} fill="#b5a48c" />
    </Art>
  ),
  detailed: (
    <Art>
      <Thumb />
      <Name y={104} w={64} />
      <Sub y={116} w={104} />
      <Sub y={125} w={80} />
      <Price y={138} w={32} />
      <g className="wf-rise">
        <Swatch x={98} y={141} fill="#1f1f22" o={0.9} />
        <Swatch x={110} y={141} fill="#c8c8cc" />
      </g>
    </Art>
  ),
  sneaker: (
    <Art>
      <Thumb />
      <Pill x={0} y={102} w={34} />
      <g>
        <path d="M96 105 l1.9 3.9 l4.3 .6 l-3.1 3 l.7 4.2 l-3.8 -2 l-3.8 2 l.7 -4.2 l-3.1 -3 l4.3 -.6 Z" fill={INK} opacity="0.62" />
        <Sub y={108} x={105} w={15} />
      </g>
      <Name y={122} w={70} />
      <Price y={134} w={26} />
      <g className="wf-rise">
        <Chip x={0} y={143} />
        <Chip x={18} y={143} />
        <Chip x={36} y={143} />
        <Chip x={54} y={143} />
      </g>
    </Art>
  ),
  data: (
    <Art>
      <Thumb />
      <g className="wf-rise">
        <Tile x={0} y={102} w={37} />
        <Tile x={41} y={102} w={37} />
        <Tile x={82} y={102} w={38} />
      </g>
      <Sub y={132} w={34} />
      <Name y={142} w={62} />
      <g>
        <Bar x={92} y={142} w={28} o={0.82} h={6} />
        <line x1="92" y1="145" x2="120" y2="145" stroke={MUTE} strokeWidth="1" />
      </g>
    </Art>
  ),
};

// ── ACTION ────────────────────────────────────────────────────────────────
const Solid = ({ y, x = 0, w = W, cls }: { y: number; x?: number; w?: number; cls?: string }) => (
  <rect className={cls} x={x} y={y} width={w} height="17" rx="8.5" fill={INK} opacity="0.88" />
);
const Ghost = ({ y, x = 0, w = W, cls }: { y: number; x?: number; w?: number; cls?: string }) => (
  <rect className={cls} x={x} y={y} width={w} height="17" rx="8.5" fill="none" stroke={LINE} strokeWidth="1.5" />
);

export const ACTION_PREVIEWS: Record<string, React.ReactNode> = {
  none: (
    <Art>
      <Thumb />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  below: (
    <Art>
      <Thumb />
      <Name y={104} w={58} />
      <Price y={118} />
      <Solid y={132} />
    </Art>
  ),
  dual: (
    <Art>
      <Thumb />
      <Name y={102} w={58} />
      <Solid y={116} />
      <Ghost y={137} />
    </Art>
  ),
  icons: (
    <Art>
      <Thumb />
      <Name y={104} w={58} />
      <Price y={118} />
      <rect x="0" y="132" width="57" height="20" rx="6" fill={FILL} />
      <path d="M23 140 a3.6 3.6 0 0 1 5.5 0 a3.6 3.6 0 0 1 5.5 0 q0 4.4 -5.5 7.6 q-5.5 -3.2 -5.5 -7.6" fill={MUTE} opacity="0.75" />
      <rect x="63" y="132" width="57" height="20" rx="6" fill={INK} opacity="0.88" />
      <path d="M85 140 h10 l-1 7 h-8 z M87 140 v-2 a4 4 0 0 1 6 0 v2" fill="none" stroke={PAPER} strokeWidth="1.4" strokeLinejoin="round" />
    </Art>
  ),
  overlay: (
    <Art>
      <Thumb />
      {/* rises up out of the image on hover, which is what it actually does */}
      <Solid y={70} x={10} w={100} cls="wf-rise" />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
};

// ── SHAPE ─────────────────────────────────────────────────────────────────
const radiusTile = (r: number, squircle = false) => (
  <Art>
    <rect x="0" y="0" width={W} height="96" rx={r} fill={FILL} />
    <Shirt x={0} y={0} w={W} h={96} />
    {squircle && (
      // A superellipse next to the arc, so the difference is visible rather
      // than described — the corner is continuous, not a quarter-circle.
      <path
        d={`M0 34 C0 8 8 0 34 0 L86 0 C112 0 120 8 120 34 L120 62 C120 88 112 96 86 96 L34 96 C8 96 0 88 0 62 Z`}
        fill="none"
        stroke={INK}
        strokeWidth="1.4"
        opacity="0.5"
      />
    )}
    <Name y={108} />
    <Price y={122} />
  </Art>
);

export const RADIUS_PREVIEWS: Record<string, React.ReactNode> = {
  sharp: radiusTile(0),
  soft: radiusTile(5),
  round: radiusTile(13),
  pill: radiusTile(24),
  squircle: radiusTile(20, true),
};

const ratioTile = (h: number) => (
  <Art>
    <rect x="0" y="0" width={W} height={h} rx="3" fill={FILL} />
    <Shirt x={0} y={0} w={W} h={h} />
    <Name y={h + 12} />
    <Price y={h + 26} />
  </Art>
);

export const RATIO_PREVIEWS: Record<string, React.ReactNode> = {
  square: ratioTile(96),
  portrait: ratioTile(112),
  tall: ratioTile(124),
  landscape: ratioTile(78),
  natural: (
    <Art>
      <rect x="0" y="0" width={W} height="70" rx="3" fill={FILL} />
      <Shirt x={0} y={0} w={W} h={70} />
      <rect x="0" y="76" width={W} height="46" rx="3" fill={FILL2} />
      <Shirt x={0} y={76} w={W} h={46} tone={INK} opacity={0.2} />
      <Name y={132} w={54} />
    </Art>
  ),
};

const shadowTile = (dy: number, blur: number, o: number) => (
  <Art>
    <defs>
      <filter id={`sh${dy}${blur}`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy={dy} stdDeviation={blur} floodOpacity={o} />
      </filter>
    </defs>
    <g filter={dy ? `url(#sh${dy}${blur})` : undefined}>
      <rect x="6" y="6" width={W - 12} height={H - 22} rx="10" fill={PAPER} stroke={dy ? 'none' : LINE} />
    </g>
    <rect x="7" y="7" width={W - 14} height="82" rx="9" fill={FILL} />
    <Shirt x={7} y={7} w={W - 14} h={82} />
    <Name x={16} y={100} w={56} />
    <Price x={16} y={114} />
  </Art>
);

export const SHADOW_PREVIEWS: Record<string, React.ReactNode> = {
  none: shadowTile(0, 0, 0),
  soft: shadowTile(3, 3.5, 0.16),
  strong: shadowTile(6, 6, 0.26),
};

export const HOVER_PREVIEWS: Record<string, React.ReactNode> = {
  none: (
    <Art>
      <Thumb />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  lift: (
    <Art>
      <g className="wf-lift">
        <Thumb />
        <Name y={108} />
        <Price y={122} />
      </g>
    </Art>
  ),
  zoom: (
    <Art>
      <g>
        <rect x="0" y="0" width={W} height="96" rx="3" fill={FILL} />
        <g clipPath="url(#wfThumbClip)">
          <g className="wf-zoom" style={{ transformOrigin: '60px 48px' }}>
            <Shirt x={0} y={0} w={W} h={96} />
          </g>
        </g>
      </g>
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  both: (
    <Art>
      <g className="wf-lift">
        <rect x="0" y="0" width={W} height="96" rx="3" fill={FILL} />
        <g clipPath="url(#wfThumbClip)">
          <g className="wf-zoom" style={{ transformOrigin: '60px 48px' }}>
            <Shirt x={0} y={0} w={W} h={96} />
          </g>
        </g>
        <Name y={108} />
        <Price y={122} />
      </g>
    </Art>
  ),
};

const gapTile = (g: number) => (
  <Art>
    <rect x="0" y="0" width={(W - g) / 2} height="70" rx="3" fill={FILL} />
    <rect x={(W + g) / 2} y="0" width={(W - g) / 2} height="70" rx="3" fill={FILL} />
    <rect x="0" y={70 + g} width={(W - g) / 2} height="70" rx="3" fill={FILL} />
    <rect x={(W + g) / 2} y={70 + g} width={(W - g) / 2} height="70" rx="3" fill={FILL} />
  </Art>
);

export const GAP_PREVIEWS: Record<string, React.ReactNode> = {
  tight: gapTile(4),
  normal: gapTile(12),
  roomy: gapTile(22),
};

// ── SHOP TOOLBAR ──────────────────────────────────────────────────────────
const MiniIcon = ({ x }: { x: number }) => (
  <rect x={x} y="8" width="17" height="17" rx="5" fill="none" stroke={LINE} strokeWidth="1.4" />
);

export const TOOLBAR_PREVIEWS: Record<string, React.ReactNode> = {
  bar: (
    <Art>
      <rect x="0" y="4" width={W} height="44" rx="8" fill="none" stroke={LINE} />
      <circle cx="12" cy="16" r="4" fill="none" stroke={MUTE} strokeWidth="1.3" />
      <rect x="21" y="13" width="52" height="5" rx="2.5" fill={INK} opacity="0.22" />
      <line x1="0" y1="27" x2={W} y2="27" stroke={LINE} />
      <Pill x={6} y={33} w={26} />
      <Pill x={36} y={33} w={22} />
      <Pill x={62} y={33} w={26} />
      <Pill x={92} y={33} w={22} />
      <rect x="0" y="58" width="57" height="42" rx="4" fill={FILL} />
      <rect x="63" y="58" width="57" height="42" rx="4" fill={FILL} />
      <rect x="0" y="106" width="57" height="42" rx="4" fill={FILL} />
      <rect x="63" y="106" width="57" height="42" rx="4" fill={FILL} />
    </Art>
  ),
  minimal: (
    <Art>
      <MiniIcon x={0} />
      <MiniIcon x={22} />
      <MiniIcon x={44} />
      <MiniIcon x={66} />
      {/* one icon opens into its control, which is the whole idea */}
      <g className="wf-rise">
        <rect x="0" y="30" width={W} height="22" rx="7" fill="none" stroke={LINE} />
        <Pill x={6} y={35} w={26} />
        <Pill x={36} y={35} w={22} />
      </g>
      <rect x="0" y="60" width="57" height="42" rx="4" fill={FILL} />
      <rect x="63" y="60" width="57" height="42" rx="4" fill={FILL} />
      <rect x="0" y="108" width="57" height="42" rx="4" fill={FILL} />
      <rect x="63" y="108" width="57" height="42" rx="4" fill={FILL} />
    </Art>
  ),
};

// ── HEADER SEARCH ─────────────────────────────────────────────────────────
// The two styles differ in WHERE the panel arrives and what it covers, which
// is a motion difference more than a static one — so both tiles show the
// arrival rather than the resting state.
const Header = () => (
  <g>
    <rect x="0" y="0" width={W} height="20" fill={PAPER} />
    <rect x="8" y="7" width="26" height="6" rx="3" fill={INK} opacity="0.7" />
    <circle cx={W - 26} cy="10" r="4" fill="none" stroke={INK} strokeWidth="1.4" opacity="0.6" />
    <line x1={W - 23} y1="13" x2={W - 20} y2="16" stroke={INK} strokeWidth="1.4" opacity="0.6" strokeLinecap="round" />
    <line x1="0" y1="20" x2={W} y2="20" stroke={LINE} />
  </g>
);

/** Rows of page content, so it is visible what each style covers. */
const PageBody = ({ from }: { from: number }) => (
  <g opacity="0.5">
    <rect x="0" y={from} width={W} height={H - from} fill={FILL} />
    <rect x="10" y={from + 12} width="44" height="34" rx="4" fill={MUTE} opacity="0.4" />
    <rect x="66" y={from + 12} width="44" height="34" rx="4" fill={MUTE} opacity="0.4" />
    <rect x="10" y={from + 54} width="44" height="34" rx="4" fill={MUTE} opacity="0.4" />
    <rect x="66" y={from + 54} width="44" height="34" rx="4" fill={MUTE} opacity="0.4" />
  </g>
);

export const SEARCH_LAYOUT_PREVIEWS: Record<string, React.ReactNode> = {
  list: (
    <Art>
      {/* one per row, small thumbnail — the most matches on screen at once */}
      <rect x="0" y="0" width={W} height={H} fill={PAPER} />
      <rect x="10" y="12" width="60" height="7" rx="3.5" fill={INK} opacity="0.7" />
      {[34, 58, 82, 106].map((y) => (
        <g key={y}>
          <rect x="10" y={y} width="18" height="18" rx="3" fill={FILL} />
          <rect x="34" y={y + 4} width="62" height="5" rx="2.5" fill={INK} opacity="0.55" />
          <rect x="34" y={y + 13} width="34" height="4" rx="2" fill={INK} opacity="0.25" />
        </g>
      ))}
    </Art>
  ),
  grid: (
    <Art>
      {/* two across, large images — the photograph is the answer */}
      <rect x="0" y="0" width={W} height={H} fill={PAPER} />
      <rect x="10" y="12" width="60" height="7" rx="3.5" fill={INK} opacity="0.7" />
      {[[10, 32], [78, 32], [10, 90], [78, 90]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="58" height="42" rx="3" fill={FILL} />
          <rect x={x} y={y + 47} width="40" height="4" rx="2" fill={INK} opacity="0.45" />
        </g>
      ))}
    </Art>
  ),
  categories: (
    <Art>
      {/* grouped under each category: a header with its count, then rows of
          thumbnail + name + sub-line, separated by hairlines */}
      <rect x="0" y="0" width={W} height={H} fill={PAPER} />
      <rect x="10" y="12" width="60" height="7" rx="3.5" fill={INK} opacity="0.7" />
      {[10, 78].map((x) => (
        <g key={x}>
          {/* uppercase group header, then the count beside it */}
          <rect x={x} y="34" width="30" height="4" rx="2" fill={INK} opacity="0.4" />
          <rect x={x + 34} y="34" width="7" height="4" rx="2" fill={INK} opacity="0.2" />
          {[48, 72, 96].map((y) => (
            <g key={y}>
              <rect x={x} y={y} width={58} height="0.8" fill={INK} opacity="0.12" />
              <circle cx={x + 8} cy={y + 12} r="7" fill={FILL} />
              <rect x={x + 19} y={y + 8} width="34" height="4" rx="2" fill={INK} opacity="0.5" />
              <rect x={x + 19} y={y + 16} width="22" height="3" rx="1.5" fill={INK} opacity="0.22" />
            </g>
          ))}
        </g>
      ))}
    </Art>
  ),
  slider: (
    <Art>
      {/* one swipeable row — runs off the edge, so the page stays short */}
      <rect x="0" y="0" width={W} height={H} fill={PAPER} />
      <rect x="10" y="12" width="60" height="7" rx="3.5" fill={INK} opacity="0.7" />
      {[10, 68, 126].map((x) => (
        <g key={x}>
          <rect x={x} y="40" width="52" height="52" rx="3" fill={FILL} />
          <rect x={x} y="98" width="36" height="4" rx="2" fill={INK} opacity="0.45" />
        </g>
      ))}
      <path d={`M${W - 14} 62 l6 6 l-6 6`} stroke={INK} strokeWidth="1.6" opacity="0.45" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Art>
  ),
};

export const SEARCH_PREVIEWS: Record<string, React.ReactNode> = {
  takeover: (
    <Art>
      <PageBody from={20} />
      <Header />
      {/* the whole screen becomes the search — fades over everything */}
      <g className="wf-fade">
        <rect x="0" y="0" width={W} height={H} fill={PAPER} />
        <rect x="10" y="14" width="72" height="9" rx="4.5" fill={INK} opacity="0.75" />
        <line x1="0" y1="34" x2={W} y2="34" stroke={LINE} />
        <path d={`M${W - 22} 14 l10 10 M${W - 12} 14 l-10 10`} stroke={INK} strokeWidth="1.6" opacity="0.6" strokeLinecap="round" />
        <rect x="10" y="46" width="30" height="30" rx="4" fill={FILL} />
        <rect x="46" y="52" width="54" height="5" rx="2.5" fill={INK} opacity="0.6" />
        <rect x="46" y="63" width="32" height="4" rx="2" fill={INK} opacity="0.28" />
        <rect x="10" y="84" width="30" height="30" rx="4" fill={FILL} />
        <rect x="46" y="90" width="48" height="5" rx="2.5" fill={INK} opacity="0.6" />
        <rect x="46" y="101" width="28" height="4" rx="2" fill={INK} opacity="0.28" />
      </g>
    </Art>
  ),
  immersive: (
    <Art>
      {/* the page itself clears out — content fades, search takes its place */}
      <g className="wf-clear">
        <PageBody from={20} />
      </g>
      <Header />
      <g className="wf-fade">
        <rect x="10" y="34" width="86" height="10" rx="5" fill={INK} opacity="0.78" />
        <rect x="10" y="60" width="46" height="46" rx="4" fill={FILL} />
        <rect x="64" y="60" width="46" height="46" rx="4" fill={FILL} />
        <rect x="10" y="110" width="34" height="5" rx="2.5" fill={INK} opacity="0.55" />
        <rect x="64" y="110" width="34" height="5" rx="2.5" fill={INK} opacity="0.55" />
        <rect x="10" y="120" width="20" height="4" rx="2" fill={INK} opacity="0.28" />
        <rect x="64" y="120" width="20" height="4" rx="2" fill={INK} opacity="0.28" />
      </g>
    </Art>
  ),
  inline: (
    <Art>
      <PageBody from={20} />
      <Header />
      {/* a CARD drops out from under the header — inset on both sides, so the
          page shows down its edges */}
      <g className="wf-rise">
        <rect x="14" y="26" width={W - 28} height="72" rx="5" fill={PAPER} />
        <line x1="14" y1="56" x2={W - 14} y2="56" stroke={LINE} />
        <rect x="24" y="36" width="60" height="8" rx="4" fill={INK} opacity="0.72" />
        <rect x="24" y="64" width="22" height="22" rx="4" fill={FILL} />
        <rect x="52" y="69" width="46" height="5" rx="2.5" fill={INK} opacity="0.6" />
        <rect x="52" y="79" width="26" height="4" rx="2" fill={INK} opacity="0.28" />
      </g>
    </Art>
  ),
  fullwidth: (
    <Art>
      <PageBody from={20} />
      <Header />
      {/* the same panel, but edge to edge — it meets both sides of the page */}
      <g className="wf-rise">
        <rect x="0" y="20" width={W} height="74" fill={PAPER} />
        <line x1="0" y1="50" x2={W} y2="50" stroke={LINE} />
        <line x1="0" y1="94" x2={W} y2="94" stroke={LINE} />
        <rect x="10" y="30" width="60" height="8" rx="4" fill={INK} opacity="0.72" />
        <rect x="10" y="58" width="22" height="22" rx="4" fill={FILL} />
        <rect x="38" y="63" width="48" height="5" rx="2.5" fill={INK} opacity="0.6" />
        <rect x="38" y="73" width="28" height="4" rx="2" fill={INK} opacity="0.28" />
        <rect x="104" y="58" width="22" height="22" rx="4" fill={FILL} />
        <rect x="132" y="63" width="42" height="5" rx="2.5" fill={INK} opacity="0.6" />
      </g>
    </Art>
  ),
};

// ── ALIGNMENT ─────────────────────────────────────────────────────────────
const alignTile = (a: 'start' | 'center' | 'end') => {
  const nameW = 68;
  const priceW = 30;
  const nx = a === 'start' ? 0 : a === 'center' ? (W - nameW) / 2 : W - nameW;
  const px = a === 'start' ? 0 : a === 'center' ? (W - priceW) / 2 : W - priceW;
  const sx = a === 'start' ? 5 : a === 'center' ? W / 2 - 12 : W - 29;
  return (
    <Art>
      <Thumb />
      <Name y={108} w={nameW} x={nx} />
      <Price y={122} w={priceW} x={px} />
      <Swatch x={sx} y={140} fill="#1f1f22" o={0.9} />
      <Swatch x={sx + 12} y={140} fill="#c8c8cc" />
    </Art>
  );
};

export const ALIGN_PREVIEWS: Record<string, React.ReactNode> = {
  start: alignTile('start'),
  center: alignTile('center'),
  end: alignTile('end'),
};

// ── REVEAL ────────────────────────────────────────────────────────────────
// Each tile performs its own reveal, because "fade" versus "rise" versus
// "stagger" is a difference you cannot draw — only show.
export const REVEAL_PREVIEWS: Record<string, React.ReactNode> = {
  none: (
    <Art>
      <Thumb />
      <Name y={108} />
      <Price y={122} />
    </Art>
  ),
  fade: (
    <Art>
      <g className="wf-fade">
        <Thumb />
        <Name y={108} />
        <Price y={122} />
      </g>
    </Art>
  ),
  rise: (
    <Art>
      <g className="wf-rise">
        <Thumb />
        <Name y={108} />
        <Price y={122} />
      </g>
    </Art>
  ),
  stagger: (
    <Art>
      <Thumb />
      <g className="wf-stagger-1">
        <Name y={108} />
      </g>
      <g className="wf-stagger-2">
        <Price y={122} />
      </g>
      <g className="wf-stagger-3">
        <Swatch x={5} y={140} fill="#1f1f22" o={0.9} />
        <Swatch x={17} y={140} fill="#c8c8cc" />
      </g>
    </Art>
  ),
};

/**
 * A choice made by picking a picture.
 *
 * `field` is the settings key; the whole tile is the control, so the label and
 * the wireframe are one target rather than a radio the size of a full stop.
 */
export function PreviewPicker({
  label,
  desc,
  field,
  options,
  previews,
}: {
  label: string;
  desc: string;
  field: string;
  options: [string, string, string?][];
  previews: Record<string, React.ReactNode>;
}) {
  const form = useSettingsForm<Record<string, string>>();
  const current = form.value[field];

  return (
    <div className="th-picker">
      <div className="th-picker__head">
        <span className="th-picker__label">{label}</span>
        <span className="th-picker__desc">{desc}</span>
      </div>
      <div className="th-picker__grid" role="radiogroup" aria-label={label}>
        {options.map(([value, title, note]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current === value}
            className={'th-opt' + (current === value ? ' on' : '')}
            onClick={() => form.set(field, value)}
          >
            <span className="th-opt__art">{previews[value] ?? null}</span>
            <span className="th-opt__name">{title}</span>
            {note && <span className="th-opt__note">{note}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
