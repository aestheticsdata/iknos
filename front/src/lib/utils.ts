import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { ClassValue } from "clsx";

/** Conditional classes, with later Tailwind utilities beating earlier ones instead of both landing. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
