import type { SVGProps } from "react";

/**
 * A dozen 16px glyphs instead of an icon package.
 *
 * They all inherit `currentColor` and the same 1.5 stroke, so they pick up the
 * design tokens and stay consistent in both themes without a second system to
 * keep in sync. Every one is `aria-hidden`: each sits next to its own label, so
 * announcing it again would only add noise.
 */
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export type IconName = keyof typeof ICONS;

export const ICONS = {
  home: (
    <Glyph>
      <path d="M2.5 7 8 2.5 13.5 7v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7Z" />
      <path d="M6.5 14V9.5h3V14" />
    </Glyph>
  ),
  funnel: (
    <Glyph>
      <path d="M2 3h12l-4.5 5v5L6.5 11.5V8L2 3Z" />
    </Glyph>
  ),
  tasks: (
    <Glyph>
      <path d="M2.5 4.5 4 6l2.5-2.5" />
      <path d="M2.5 11.5 4 13l2.5-2.5" />
      <path d="M8.5 5h5" />
      <path d="M8.5 12h5" />
    </Glyph>
  ),
  product: (
    <Glyph>
      <path d="M8 1.75 14 5v6l-6 3.25L2 11V5l6-3.25Z" />
      <path d="M2 5l6 3.25L14 5" />
      <path d="M8 8.25V14.5" />
    </Glyph>
  ),
  settings: (
    <Glyph>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.75" />
      <circle cx="10.5" cy="11.5" r="1.75" />
    </Glyph>
  ),
  chevron: (
    <Glyph>
      <path d="m4.5 6.5 3.5 3 3.5-3" />
    </Glyph>
  ),
  check: (
    <Glyph>
      <path d="m3.5 8.5 3 3 6-7" />
    </Glyph>
  ),
  plus: (
    <Glyph>
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </Glyph>
  ),
  menu: (
    <Glyph>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
    </Glyph>
  ),
  close: (
    <Glyph>
      <path d="m4 4 8 8" />
      <path d="m12 4-8 8" />
    </Glyph>
  ),
  user: (
    <Glyph>
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.75 14c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4" />
    </Glyph>
  ),
  card: (
    <Glyph>
      <rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.5" />
      <path d="M1.75 6.75h12.5" />
    </Glyph>
  ),
  book: (
    <Glyph>
      <path d="M3 2.5h5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H3v-9.5Z" />
      <path d="M13 2.5H9.5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5H13v-9.5Z" />
    </Glyph>
  ),
  help: (
    <Glyph>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.25 6.25a1.75 1.75 0 1 1 2.4 1.62c-.4.16-.65.55-.65.98v.4" />
      <path d="M8 11.75h.01" />
    </Glyph>
  ),
  logout: (
    <Glyph>
      <path d="M6 2.75H3.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1H6" />
      <path d="M10 5.5 12.5 8 10 10.5" />
      <path d="M12.5 8H6" />
    </Glyph>
  ),
} as const;

export function Icon({ name }: { name: IconName }) {
  return ICONS[name];
}
