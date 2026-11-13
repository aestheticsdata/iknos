"use client";

import { closedTour, currentTour, subscribeTour } from "@lib/tourState";
import { useSyncExternalStore } from "react";

/** The tour's step, closed on the server and during hydration — as `useTheme` is `null` there. */
export const useTour = () => useSyncExternalStore(subscribeTour, currentTour, closedTour);
