// src/pages/UsagePolicy.jsx
import { Link } from "react-router-dom";

export default function UsagePolicy() {
  const effectiveDate = "January 1, 2025";

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-[color:var(--brand-700)]">
            Shepherd&apos;s Table Cloud — Usage Policy
          </h1>
          <p className="text-sm text-gray-500">Effective date: {effectiveDate}</p>
          <p className="mt-1 text-xs text-gray-500">
            This Usage Policy is a practical guide for staff and volunteers. It
            works together with our{" "}
            <Link to="/terms" className="underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
        </header>

        <div className="prose prose-sm sm:prose max-w-none">
          <h2>1. Purpose</h2>
          <p>
            Shepherd&apos;s Table Cloud (the &quot;Platform&quot;) is a secure
            system for authorized staff and volunteers of participating
            organizations to log client visits, manage client records, and
            generate reports for food assistance programs (for example USDA /
            EFAP / TEFAP and similar programs). This policy explains how you are
            expected to use the Platform safely and appropriately.
          </p>

          <h2>2. Authorized Access</h2>
          <ul>
            <li>
              Only approved users with valid login credentials may access the
              Platform.
            </li>
            <li>
              Always use your own assigned account. Do not share accounts or
              sign in as someone else.
            </li>
            <li>
              Keep your login credentials private and secure. Do not write them
              on shared computers or leave them visible to others.
            </li>
            <li>
              Immediately report any suspected unauthorized access, lost device,
              or other security concern to your organization&apos;s
              administrator or supervisor.
            </li>
          </ul>

          <h2>3. Data Accuracy and Integrity</h2>
          <ul>
            <li>
              Enter accurate and complete information when recording client
              data, household details, and visits.
            </li>
            <li>
              Avoid entering false, duplicate, or misleading information. If you
              find a mistake, correct it or alert your administrator.
            </li>
            <li>
              Follow your organization&apos;s intake and verification
              procedures, including any required consent or forms.
            </li>
          </ul>

          <h2>4. Confidentiality</h2>
          <p>
            All data in the Platform, including client personal information and
            visit history, is confidential. It must only be used for authorized
            program and reporting purposes. This means:
          </p>
          <ul>
            <li>
              Do not discuss client information in public areas or with people
              who do not have a &quot;need to know&quot; for their job.
            </li>
            <li>
              Do not share screenshots, exports, or reports with unauthorized
              individuals or on personal devices or social media.
            </li>
            <li>
              If you download or print reports, store them securely and follow
              your organization&apos;s policies for retention and shredding or
              disposal.
            </li>
            <li>
              Do not use client information from the Platform for immigration
              enforcement, debt collection, or marketing unrelated to food
              assistance services.
            </li>
          </ul>

          <h2>5. Prohibited Use</h2>
          <p>When using the Platform, you must not:</p>
          <ul>
            <li>
              Attempt to bypass security or gain access to data you are not
              authorized to see.
            </li>
            <li>
              Share your account, impersonate another user, or let someone use
              the Platform under your name.
            </li>
            <li>
              Use the Platform for personal, commercial, or non program related
              activities.
            </li>
            <li>
              Download or copy large amounts of data for use outside of approved
              systems, except as directed by your organization&apos;s policies.
            </li>
            <li>
              Upload malicious code, interfere with the Platform&apos;s
              operation, or attempt to damage or disrupt the system.
            </li>
            <li>
              Use the Platform to discriminate against, harass, or target
              clients in violation of program rules or civil rights protections.
            </li>
          </ul>

          <h2>6. Monitoring and Enforcement</h2>
          <p>
            System activity (such as logins, changes to records, and exports)
            may be logged for security, audit, and compliance purposes. Your
            organization&apos;s administrators and our technical team may review
            logs when needed to investigate security incidents or suspected
            misuse. Violations of this policy may result in suspension or
            termination of access, and may also lead to additional action under
            your organization&apos;s policies or applicable law.
          </p>

          <h2>7. Updates to this Policy</h2>
          <p>
            Shepherd&apos;s Table Cloud may update this Usage Policy periodically
            to reflect changes in the Platform, program requirements, or
            applicable laws. The effective date above will indicate the latest
            version. Your continued use of the Platform means you agree to the
            current policy.
          </p>

          <h2>8. Questions &amp; Reporting Misuse</h2>
          <p>
            If you have questions about how to use the Platform correctly, ask
            your organization&apos;s administrator or supervisor. To report
            suspected misuse, security concerns, or privacy issues, contact your
            organization&apos;s administrator and, if needed, reach out to us at:
          </p>
          <p>
            Text{" "}
            <a
              href="sms:+13106256844"
              className="text-[color:var(--brand-700)] hover:text-[color:var(--brand-800)] font-medium"
            >
              (310) 625-6844
            </a>
            .
          </p>

          <p className="mt-8">
            <Link
              to="/login"
              className="text-[color:var(--brand-700)] hover:text-[color:var(--brand-800)]"
            >
              ← Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
