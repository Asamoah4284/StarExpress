import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** @param {number} n */
export function formatCedis(n) {
  const formatted = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n)
  return `GH₵ ${formatted}`
}
