import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "iknos:public";

/**
 * Marks a route — or a whole controller — as reachable without a session.
 *
 * There are meant to be very few of these: `/health`, and the auth routes that by definition
 * run before a session exists. Every one of them is a hole in the default-deny property, so
 * adding one should feel like a decision rather than a convenience.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
