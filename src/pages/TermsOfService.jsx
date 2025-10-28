// src/pages/TermsOfService.jsx
import { Link } from "react-router-dom";

export default function TermsOfService() {
  const updated = "October 27, 2025";

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-gray-600">Last updated: {updated}</p>
      </header>

      <div className="rounded-2xl border border-brand-100 bg-white shadow-soft overflow-hidden">
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <p className="text-sm text-gray-800">
            These Terms govern your access to and use of Shepherd’s Table Cloud (the “Service”)
            provided by LEGAL_NAME (“we,” “us,” or “our”). By using the Service, you agree to these
            Terms and our <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">1) Eligibility & Accounts</h2>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>You must be an authorized staff member or volunteer of a participating organization.</li>
            <li>You are responsible for safeguarding your credentials and for all activity under your account.</li>
            <li>You will comply with applicable laws and program rules when handling client data.</li>
          </ul>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">2) Acceptable Use</h2>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>No unlawful, infringing, or deceptive activity.</li>
            <li>No sharing of client information outside permitted program/reporting purposes.</li>
            <li>No reverse engineering, scraping, or circumventing security.</li>
            <li>No uploading malware or interfering with the Service’s operation.</li>
          </ul>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">3) Your Content</h2>
          <p className="mt-2 text-sm text-gray-800">
            You retain all rights in the data you input. You grant us a limited license to host,
            process, and display that data to provide the Service and generate forms/reports. You
            represent you have authority to process such data for your organization’s purposes.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">4) Service Providers & Third-Party Services</h2>
          <p className="mt-2 text-sm text-gray-800">
            We use trusted providers (e.g., Google Firebase for authentication, database, and file
            storage; Mapbox for address lookup) to operate the Service. Your use may also be
            subject to those providers’ terms and policies.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">5) Availability & Modifications</h2>
          <p className="mt-2 text-sm text-gray-800">
            We may modify or discontinue features with reasonable notice where practical. We aim for
            high availability but do not guarantee uninterrupted or error-free operation.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">6) Fees</h2>
          <p className="mt-2 text-sm text-gray-800">
            If applicable, fees and billing terms will be set forth in an order form or separate
            agreement. Unpaid amounts may result in suspension.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">7) Confidentiality & Security</h2>
          <p className="mt-2 text-sm text-gray-800">
            We will implement reasonable safeguards and treat client data as confidential. You are
            responsible for restricting access within your organization and training your users on
            proper handling of personal information.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">8) Compliance</h2>
          <p className="mt-2 text-sm text-gray-800">
            You will use the Service in compliance with applicable laws (including California
            consumer privacy laws) and applicable program rules for food assistance programs.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">9) Disclaimers</h2>
          <p className="mt-2 text-sm text-gray-800">
            THE SERVICE IS PROVIDED “AS IS.” TO THE EXTENT PERMITTED BY LAW, WE DISCLAIM ALL
            WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, AND NON-INFRINGEMENT.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">10) Limitation of Liability</h2>
          <p className="mt-2 text-sm text-gray-800">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES. OUR TOTAL LIABILITY FOR ALL
            CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE AMOUNTS PAID BY YOU TO US FOR THE
            TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM (OR, IF NONE, $100).
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">11) Indemnification</h2>
          <p className="mt-2 text-sm text-gray-800">
            You agree to indemnify and hold us harmless from claims arising from your misuse of the
            Service or violation of these Terms.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">12) Termination</h2>
          <p className="mt-2 text-sm text-gray-800">
            You may stop using the Service at any time. We may suspend or terminate access for
            violation of these Terms or for security reasons. Upon termination, we will handle your
            data in accordance with our <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">13) Governing Law; Dispute Resolution</h2>
          <p className="mt-2 text-sm text-gray-800">
            These Terms are governed by the laws of the State of California, without regard to
            conflict-of-law principles. Any disputes will be resolved in the state or federal courts
            located in Los Angeles County, California, and the parties consent to jurisdiction and
            venue there.
          </p>
        </section>

        <section className="px-4 md:px-6 py-5">
          <h2 className="text-lg font-semibold">14) Contact</h2>
          <p className="mt-2 text-sm text-gray-800">
            Questions about these Terms? Email{" "}
            <a href="mailto:CONTACT_EMAIL" className="underline"></a> or write to:
          </p>
          <address className="mt-2 not-italic text-sm text-gray-800">
            <br />
            <br />
            United States
          </address>
        </section>
      </div>
    </div>
  );
}
