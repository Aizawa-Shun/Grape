import type { ProductInput } from "@/lib/validation/product";

export interface ProductActionState {
  status: "idle" | "error" | "success";
  errors?: Partial<Record<keyof ProductInput, string[]>>;
  message?: string;
}

export const initialProductActionState: ProductActionState = { status: "idle" };
