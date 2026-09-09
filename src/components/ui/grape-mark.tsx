import Image from "next/image";

import { cx } from "./cx";
import mark from "./grape-mark.png";

/**
 * The Grape mark, for use beside the wordmark.
 *
 * The source art is solid black on an off-white plate. Here it is the same
 * shape with the plate turned into transparency, so it sits on whatever
 * surface it is placed on — and inverted under a dark theme, which for a
 * one-colour mark turns the black into white rather than leaving it to
 * disappear into a dark sidebar. That is what `logo-mark` in globals.css does;
 * it is a two-line rule rather than a second asset because there is only one
 * colour to flip.
 *
 * `priority` because this sits in the app shell and the sidebar renders on
 * every navigation: a mark that fades in after the nav is drawn reads as the
 * page still loading.
 */
export function GrapeMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <Image
      src={mark}
      alt=""
      width={size}
      height={size}
      priority
      className={cx("logo-mark", className)}
      style={{ width: size, height: "auto" }}
    />
  );
}
