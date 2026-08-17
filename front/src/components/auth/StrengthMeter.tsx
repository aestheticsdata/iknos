import { SECRET_RULES } from "@lib/fieldLimits";

/**
 * Four segments, scored the way Zeus scores its gauge: a point for clearing the minimum, a point
 * for reaching 16, a point for a digit, a point for a symbol or mixed case.
 *
 * **Advisory, and nothing else.** Nothing here blocks a submit — the only hard rule is the length
 * minimum, enforced by the schema and again by the API, and there are deliberately no composition
 * rules. A meter that refuses passwords teaches people to write them down; a meter that comments
 * on them does not.
 */
const score = (secret: string): number => {
  let points = 0;
  if (secret.length >= SECRET_RULES.passwordMin) points += 1;
  if (secret.length >= 16) points += 1;
  if (/[0-9]/.test(secret)) points += 1;
  if (/[^a-zA-Z0-9]/.test(secret) || (/[a-z]/.test(secret) && /[A-Z]/.test(secret))) points += 1;
  return points;
};

/**
 * The mockup paints every filled segment the same green. Colouring by score instead costs nothing
 * and is the only reason a meter exists — four green bars at two points say "good" while meaning
 * "weak". The tokens are the chassis ramp's own; no new colour enters the product for this.
 */
const FILL = ["bg-chassis-error", "bg-chassis-error", "bg-chassis-warn", "bg-chassis-accent/70", "bg-chassis-accent"];

export const StrengthMeter = ({ secret }: { secret: string }) => {
  const points = score(secret);

  return (
    <div className="flex gap-[3px]">
      {[0, 1, 2, 3].map((segment) => (
        <div
          className={`h-[3px] flex-1 transition-colors duration-200 ${
            secret && segment < points ? FILL[points] : "bg-chassis-border"
          }`}
          key={segment}
        />
      ))}
    </div>
  );
};
