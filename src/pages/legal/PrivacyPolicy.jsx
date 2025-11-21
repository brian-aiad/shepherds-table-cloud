// src/pages/PrivacyPolicy.jsx
import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  const updated = "October 27, 2025";

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-gray-600">Last updated: {updated}</p>
      </header>

      <div className="rounded-2xl border border-brand-100 bg-white shadow-soft overflow-hidden">
        {/* Notice at Collection */}
        <section className="px-4 md:px-6 py-4 border-b border-brand-100 bg-brand-50/60">
          <h2 className="text-lg font-semibold">Notice at Collection (California)</h2>
          <p className="mt-2 text-sm text-gray-800">
            This notice explains the categories of personal information we collect and why we
            collect it. We use this information to register clients, verify eligibility for food
            programs (e.g., EFAP/USDA), log visits, and generate required reports for partner
            organizations and agencies.
          </p>
        </section>

        {/* Table of Contents */}
        <nav className="px-4 md:px-6 py-3 text-sm border-b border-brand-100 bg-white">
          <ul className="list-disc pl-5 space-y-1">
            <li><a className="text-brand-800 hover:underline" href="#what-we-collect">What we collect</a></li>
            <li><a className="text-brand-800 hover:underline" href="#how-we-use">How we use information</a></li>
            <li><a className="text-brand-800 hover:underline" href="#sharing">How we share information</a></li>
            <li><a className="text-brand-800 hover:underline" href="#ccpa">Your California privacy rights</a></li>
            <li><a className="text-brand-800 hover:underline" href="#security">Security</a></li>
            <li><a className="text-brand-800 hover:underline" href="#retention">Retention</a></li>
            <li><a className="text-brand-800 hover:underline" href="#children">Children’s privacy</a></li>
            <li><a className="text-brand-800 hover:underline" href="#changes">Changes to this policy</a></li>
            <li><a className="text-brand-800 hover:underline" href="#contact">Contact us</a></li>
          </ul>
        </nav>

        {/* What we collect */}
        <section id="what-we-collect" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">What we collect</h2>
          <p className="mt-2 text-sm text-gray-800">
            We collect information directly from you (or your volunteers) when creating a client
            record or logging a visit, and automatically from your device to keep the service
            secure. The categories of personal information we collect include:
          </p>
          <ul className="mt-3 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li><b>Identifiers</b> (name, phone number, email if provided).</li>
            <li><b>Demographic / household</b> (date of birth, ZIP code, county, household size).</li>
            <li><b>Addresses</b> (street, city—optionally looked up via Mapbox).</li>
            <li><b>Program data</b> (visit dates/times, location, whether first USDA visit this month).</li>
            <li><b>Organization context</b> (your selected org and location within the app).</li>
            <li><b>Device & usage</b> (IP address, browser info, timestamps) used for security and abuse prevention.</li>
          </ul>
          <p className="mt-3 text-sm text-gray-700">
            We do not collect precise geolocation, biometric data, or payment card numbers. We do
            not sell personal information. We do not use third-party behavioral ads.
          </p>
        </section>

        {/* How we use */}
        <section id="how-we-use" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">How we use information</h2>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>To register clients and log visits for service delivery.</li>
            <li>To generate EFAP/USDA sign-in forms and monthly/annual reports.</li>
            <li>To maintain accurate records and prevent duplicate client profiles.</li>
            <li>To operate, secure, troubleshoot, and improve the application.</li>
            <li>To comply with applicable laws and program requirements.</li>
          </ul>
        </section>

        {/* Sharing */}
        <section id="sharing" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">How we share information</h2>
          <p className="mt-2 text-sm text-gray-800">
            We share information only as needed to operate the service, comply with the law,
            or with your direction/consent:
          </p>
          <ul className="mt-3 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li><b>Service providers</b> that process data on our behalf:
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>Google Firebase (Authentication, Firestore, Storage).</li>
                <li>Mapbox (address lookup/standardization).</li>
                <li>Infrastructure, logging, and email providers (if support is requested).</li>
              </ul>
            </li>
            <li><b>Reporting recipients</b> (e.g., your food bank or agency partners) as needed to complete required program forms and reports you generate in the app.</li>
            <li><b>Legal</b> if required by law or to protect rights, safety, or the integrity of the service.</li>
          </ul>
          <p className="mt-3 text-sm text-gray-700">
            We do not sell or share personal information for targeted advertising.
          </p>
        </section>

        {/* CCPA/CPRA Rights */}
        <section id="ccpa" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">Your California privacy rights (CCPA/CPRA)</h2>
          <p className="mt-2 text-sm text-gray-800">
            If you are a California resident, you have the right to:
          </p>
          <ul className="mt-3 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li><b>Know/Access</b> the categories and specific pieces of personal information we collect about you.</li>
            <li><b>Delete</b> personal information (subject to legal/reporting obligations).</li>
            <li><b>Correct</b> inaccurate information.</li>
            <li><b>Opt-out</b> of “sale” or “sharing” (we do not sell or share for cross-context ads).</li>
            <li><b>Limit use of sensitive information</b> (we collect minimal sensitive data—DOB and household size—only for program eligibility/records).</li>
            <li><b>Non-discrimination</b> for exercising these rights.</li>
          </ul>
          <p className="mt-3 text-sm text-gray-800">
            To exercise your rights, contact us at{" "}
            <a href="mailto:CONTACT_EMAIL" className="underline">CONTACT_EMAIL</a>. We will verify requests
            as required by law and respond within applicable timelines.
          </p>
        </section>

        {/* Security */}
        <section id="security" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">Security</h2>
          <p className="mt-2 text-sm text-gray-800">
            We implement reasonable administrative, technical, and physical safeguards, including
            role-based access, encrypted transport, and Firebase security rules. No system is 100%
            secure; please keep your credentials safe and limit access to authorized staff.
          </p>
        </section>

        {/* Retention */}
        <section id="retention" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">Retention</h2>
          <p className="mt-2 text-sm text-gray-800">
            We retain records as necessary to support ongoing program operations and required
            reporting. If you close your account or request deletion, we will delete or de-identify
            personal information unless we must keep it to comply with legal, audit, or program
            obligations. Generated reports you have exported are outside our control.
          </p>
        </section>

        {/* Children */}
        <section id="children" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">Children’s privacy</h2>
          <p className="mt-2 text-sm text-gray-800">
            This service is used by food banks and their authorized staff/volunteers. It is not
            directed to children under 13. We do not knowingly create user accounts for minors.
          </p>
        </section>

        {/* Changes */}
        <section id="changes" className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">Changes to this policy</h2>
          <p className="mt-2 text-sm text-gray-800">
            We may update this policy from time to time. If we make material changes, we will post
            the updated policy in the app and adjust the “Last updated” date above.
          </p>
        </section>

        {/* Contact */}
        <section id="contact" className="px-4 md:px-6 py-5">
          <h2 className="text-lg font-semibold">Contact us</h2>
          <p className="mt-2 text-sm text-gray-800">
            Questions or requests? Email{" "}
            <a href="mailto:CONTACT_EMAIL" className="underline"></a> or write to:
          </p>
          <address className="mt-2 not-italic text-sm text-gray-800">
            
            United States
          </address>
          <p className="mt-4 text-xs text-gray-600">
            By using this service, you also agree to our{" "}
            <Link className="underline" to="/terms">Terms of Service</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
