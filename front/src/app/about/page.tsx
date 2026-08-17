import { AuthChassis } from "@components/auth/AuthChassis";
import { LEGAL } from "@text/auth";

/** The legal notice — a key/value list on the same chassis as the three forms (§5.7). */
const AboutPage = () => (
  <AuthChassis page="about">
    <dl className="flex flex-col">
      {LEGAL.map((entry) => (
        <div
          className="flex items-center gap-[18px] border-b border-chassis-raised py-[9px] last:border-b-0"
          key={entry.k}
        >
          <dt className="w-[88px] flex-none text-dense text-chassis-text-dim">{entry.k}</dt>
          <dd className="flex-1 text-dense text-chassis-text">{entry.v}</dd>
        </div>
      ))}
    </dl>
  </AuthChassis>
);

export default AboutPage;
