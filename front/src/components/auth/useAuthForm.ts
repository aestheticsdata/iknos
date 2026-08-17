"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { FieldValues, Path, UseFormProps, UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * The three account forms' shared validation timing, copied from Zeus:
 *
 *   - validate when a field is LEFT           → `mode: "onTouched"`
 *   - clear on the keystroke that FIXES it    → `reValidateMode: "onChange"`
 *   - say nothing about a field the user has EMPTIED, until submit
 *
 * Only the third needs code. Left alone, clearing a field and tabbing away earns a "required" —
 * a scolding for a field the person is plainly still working on. `clearOnEmpty` drops the error the
 * moment the value goes back to empty; submit-time validation still catches it, at the moment it
 * actually matters.
 */
export const useAuthForm = <T extends FieldValues>(
  // `ZodType<T, T>` rather than `ZodType<T>`: the resolver needs the schema's *input* type to be
  // assignable to FieldValues, and the one-argument form leaves it `unknown`.
  schema: ZodType<T, T>,
  options?: Omit<UseFormProps<T>, "resolver" | "mode" | "reValidateMode">,
): UseFormReturn<T> & { clearOnEmpty: (name: Path<T>) => void } => {
  const form = useForm<T>({
    resolver: zodResolver(schema) as never,
    mode: "onTouched",
    reValidateMode: "onChange",
    ...options,
  });

  const clearOnEmpty = (name: Path<T>) => {
    if (!form.getValues(name)) form.clearErrors(name);
  };

  return { ...form, clearOnEmpty };
};
