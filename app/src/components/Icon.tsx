import type { ReactNode, SVGProps } from 'react';

// The one icon frame (brand sweep, 2026-09-24). Every inline glyph used to
// carry its own stroke width (eleven of them, 1.2 to 2.4), so icons side by
// side never matched. Now each draws on the shared 24-unit grid and takes its
// weight from a token in theme.css (`--icon-stroke` 1.8, `--icon-stroke-hairline`
// 1.4) through the `.icon` class, in currentColor with round caps and joins.
// Pass the paths as children, unchanged. The brand mark (BrandMark, WaveMark)
// is drawn on its own grid and stays outside this frame.

type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  'viewBox' | 'strokeWidth' | 'stroke' | 'fill' | 'children'
> & {
  /** Rendered width and height in px. Omit to size from CSS. */
  size?: number;
  /** `standard` (1.8) for UI glyphs, `hairline` (1.4) for large or outlined
   *  marks such as the rating star. */
  weight?: 'standard' | 'hairline';
  /** `stroke` draws outlines; `fill` paints solid shapes in currentColor. */
  variant?: 'stroke' | 'fill';
  children: ReactNode;
};

export function Icon({
  size,
  weight = 'standard',
  variant = 'stroke',
  className,
  children,
  ...rest
}: IconProps) {
  const classes = ['icon', weight === 'hairline' ? 'icon-hairline' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={variant === 'fill' ? 'currentColor' : 'none'}
      stroke={variant === 'fill' ? 'none' : 'currentColor'}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
      className={classes}
    >
      {children}
    </svg>
  );
}
