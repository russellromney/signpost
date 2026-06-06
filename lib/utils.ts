import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge conditional class names and resolve Tailwind conflicts. Used by the
// shadcn/ui components.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
