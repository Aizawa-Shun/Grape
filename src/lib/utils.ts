import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwindのクラス名を条件付きで結合し、競合するユーティリティクラスを
 * (tailwind-mergeにより)正しく上書きする。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
