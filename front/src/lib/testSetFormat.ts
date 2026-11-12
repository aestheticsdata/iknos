import type { NumberedCall, TestCall } from "@lib/interfaces/testSetTypes";

/** A kept run's calls with their place in the run — they never reorder, so it is their identity (IKN-95). */
export const numberedCalls = (calls: TestCall[]): NumberedCall[] =>
  calls.map((call, position) => ({ ...call, position }));
