import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy notice' };

/**
 * DRAFT privacy notice for the Daily Journal (Data Privacy Act of 2012, RA 10173).
 * PLACEHOLDER: to be reviewed and completed by the ministry's Data Protection Officer before
 * launch — contact details below are intentionally marked for completion.
 */
export default function PrivacyPage() {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="inline-block rounded-full bg-warn-tint px-3 py-0.5 text-sm font-medium text-warn">Draft for review</p>
        <h1 className="text-[28px] leading-tight">Privacy notice</h1>
        <p className="text-muted">
          Generation Touch Harvest International (“GenTouch”) cares for your privacy the way we care for you. This notice explains
          what we keep when you use the Daily Journal and how we protect it, in line with the Data Privacy Act of 2012 (RA 10173).
        </p>
      </header>

      <Section title="What we collect">
        <ul className="list-disc space-y-1 pl-6">
          <li>Your name, and optionally your mobile number and year of birth.</li>
          <li>Who your leader is in our discipleship structure.</li>
          <li>The journals you send, and when you sent them.</li>
          <li>For people under 18: the name of the parent or guardian who agreed.</li>
          <li>A random code saved on your phone so we can recognise it next time. We don’t track your location or other apps.</li>
        </ul>
      </Section>

      <Section title="Why we collect it">
        <p>
          So your leaders and pastors can pray for you, encourage you and follow up when you may need care. We never sell your
          information or use it for advertising.
        </p>
      </Section>

      <Section title="Who can see it">
        <ul className="list-disc space-y-1 pl-6">
          <li>Your leaders can see whether your journal was received.</li>
          <li>Your direct leader and your pastors can read your answers.</li>
          <li>Answers marked “only your pastors can read this” are seen by pastors only.</li>
          <li>Ministry office staff can see your name and details, but not your journal answers.</li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your journal while you are part of the ministry. You can ask us to remove your information at any time, and we will
          do so unless we must keep something by law.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You may ask to see, correct or delete your information, or object to how it is used. Talk to your leader, or contact our Data
          Protection Officer.
        </p>
        <p className="rounded-lg border border-dashed border-line-strong p-3 text-base text-muted">
          Data Protection Officer: <strong>[to be completed by the ministry]</strong>
          <br />
          Email: <strong>[to be completed]</strong>
        </p>
      </Section>

      <p className="text-sm text-muted">Version: 2026-09-01 (draft)</p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl">{title}</h2>
      {children}
    </section>
  );
}
