import type { MODAL_SIZE } from "../modalSize";

export type ModalSize = (typeof MODAL_SIZE)[keyof typeof MODAL_SIZE];
