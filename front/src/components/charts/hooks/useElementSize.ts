"use client";

import { useEffect, useState } from "react";

/**
 * An element's size in whole pixels, kept current with a `ResizeObserver` (IKN-86).
 *
 * The bars are placed on pixel boundaries, so they have to know how many pixels they have. A
 * callback ref rather than a ref object: a chart that mounts after its first render, behind a
 * loading state, still gets observed.
 */
export const useElementSize = <T extends HTMLElement>() => {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      const next = { width: Math.floor(box.width), height: Math.floor(box.height) };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref: setNode, node, width: size.width, height: size.height };
};
