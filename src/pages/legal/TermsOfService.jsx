// src/pages/TermsOfService.jsx
import { Link } from "react-router-dom";

export default function TermsOfService() {
  const updated = "December 1, 2025";

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-600">Last updated: {updated}</p>
      </header>

      <div className="rounded-2xl border border-brand-100 bg-white shadow-soft overflow-hidden">
        {/* Intro */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <p className="text-sm text-gray-800">
            These Terms of Service (the &quot;Terms&quot;) govern your access to and use of
            Shepherd&apos;s Table Cloud (the &quot;Service&quot;) provided by LEGAL_NAME
            (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). By using the Service, you agree
            to these Terms and to our{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
          <p className="mt-2 text-xs text-gray-600">
            These Terms are intended for organizations such as food banks,
            pantries, and community partners that use the Service to manage
            client intake, visits, and related food assistance program records.
            They do not replace any written agreement or order form you may sign
            with us. If there is a conflict between these Terms and a signed
            agreement, the signed agreement will control to the extent of the
            conflict.
          </p>
        </section>

        {/* 1) Eligibility & Accounts */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">1) Eligibility &amp; Accounts</h2>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>
              You must be an authorized staff member, volunteer, or contractor
              of a participating organization to use the Service.
            </li>
            <li>
              You are responsible for safeguarding your login credentials and
              for all activity under your account. You will promptly notify us
              or your organization&apos;s administrator of any suspected
              unauthorized access.
            </li>
            <li>
              You are responsible for ensuring that your use of the Service, and
              the data you input into it, complies with applicable laws and food
              program rules (for example, EFAP / TEFAP and any state or local
              requirements).
            </li>
          </ul>
        </section>

        {/* 2) Acceptable Use */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">2) Acceptable Use</h2>
          <p className="mt-2 text-sm text-gray-800">
            You agree to use the Service only for legitimate program and
            administrative purposes related to your organization. You will not:
          </p>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>
              Engage in unlawful, infringing, deceptive, or fraudulent activity.
            </li>
            <li>
              Use client information for purposes unrelated to program
              administration or reporting, such as general consumer marketing,
              debt collection, or harassment.
            </li>
            <li>
              Use the Service or data obtained through it for immigration
              enforcement or surveillance activities.
            </li>
            <li>
              Discriminate against or target clients in violation of applicable
              civil rights laws or program rules.
            </li>
            <li>
              Attempt to reverse engineer, decompile, disassemble, or otherwise
              derive source code from the Service, except to the extent this
              restriction is prohibited by law.
            </li>
            <li>
              Scrape, crawl, or systematically harvest data from the Service,
              except through documented APIs we make available to you.
            </li>
            <li>
              Bypass, disable, or circumvent security or access controls, or
              test the vulnerability of the Service without our prior written
              permission.
            </li>
            <li>
              Upload or transmit malware, malicious code, or anything designed
              to interfere with the proper operation of the Service.
            </li>
          </ul>
        </section>

        {/* 3) Your Content & Role of the Service */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">
            3) Your Content &amp; Our Role
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            As between you and us, you retain all rights in the data and content
            you or your users input into the Service (&quot;Your Content&quot;).
            You grant us a limited, non exclusive license to host, process,
            store, display, and otherwise use Your Content only as needed to:
          </p>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>Provide, maintain, and improve the Service;</li>
            <li>
              Generate forms, reports, and exports that you or your organization
              request, including food program reports;
            </li>
            <li>
              Comply with legal, audit, and food program record keeping
              requirements that apply to us as a technology provider; and
            </li>
            <li>
              Protect the security, integrity, and availability of the Service.
            </li>
          </ul>
          <p className="mt-2 text-sm text-gray-800">
            For client intake and visit records, we generally act as a &quot;service
            provider&quot; or &quot;contractor&quot; (or similar term) to your
            organization under applicable privacy laws. We do not sell client
            personal information or share it for cross context behavioral
            advertising. We will use client data only as allowed by our
            agreement with your organization and applicable law.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            You represent and warrant that you have the authority to input and
            process Your Content in the Service, that you have provided any
            required notices, and that your use of the Service and Your Content
            does not violate any law or rights of others.
          </p>
        </section>

        {/* 4) Service Providers & Third-Party Services */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">
            4) Service Providers &amp; Third-Party Services
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            We use trusted service providers to help operate the Service, such
            as:
          </p>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>
              Google Firebase for authentication, database, and file storage;
            </li>
            <li>Mapbox or similar tools for address lookup and mapping; and</li>
            <li>
              Infrastructure, logging, analytics with privacy safeguards, and
              email providers to support hosting, monitoring, and support.
            </li>
          </ul>
          <p className="mt-2 text-sm text-gray-800">
            Your use of certain features may also be subject to the providers&apos;
            terms and policies (for example, Firebase or Mapbox terms). We
            require our service providers to use personal information only as
            needed to provide services to us and to maintain reasonable security
            consistent with applicable law.
          </p>
        </section>

        {/* 5) Availability & Modifications */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">
            5) Availability &amp; Modifications
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            We aim for high availability but do not guarantee uninterrupted or
            error free operation. We may modify, suspend, or discontinue all or
            part of the Service (including particular features or integrations)
            with reasonable notice where practical. If we make a material
            change that significantly reduces core functionality, we will
            provide notice to the primary contact for your organization.
          </p>
        </section>

        {/* 6) Fees */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">6) Fees</h2>
          <p className="mt-2 text-sm text-gray-800">
            If applicable, fees, billing terms, and subscription periods will be
            set forth in an order form, invoice, or separate agreement between
            us and your organization. You are responsible for timely payment of
            all amounts due. We may suspend or limit access to the Service for
            nonpayment after providing reasonable notice to the billing contact.
          </p>
        </section>

        {/* 7) Confidentiality & Security */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">
            7) Confidentiality &amp; Security
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            We will treat Your Content as confidential and will only use or
            disclose it as permitted under these Terms, our{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>
            , and any separate agreement with your organization.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            We implement reasonable administrative, technical, and physical
            safeguards designed to protect personal information, consistent with
            applicable laws such as California Civil Code section 1798.81.5.
            However, no system can be completely secure. You acknowledge that
            there is some risk in transmitting and storing data electronically.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            You are responsible for managing access within your organization,
            including selecting appropriate user roles, promptly revoking
            access for users who no longer need it, and providing training on
            proper handling of personal information and food program rules.
          </p>
        </section>

        {/* 8) Compliance; Program & Privacy Responsibilities */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">
            8) Compliance; Program &amp; Privacy Responsibilities
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            You will use the Service in compliance with all applicable laws and
            regulations, including food assistance program rules and any
            applicable privacy or consumer protection laws. This may include,
            for example, requirements under EFAP / TEFAP such as maintaining
            accurate records, protecting the confidentiality of clients, and
            retaining certain records for at least three years from the close of
            the relevant fiscal year or longer if required for audits or
            investigations.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            To the extent privacy laws such as the California Consumer Privacy
            Act (as amended by the California Privacy Rights Act) apply, your
            organization is responsible for providing any required notices to
            clients, responding to privacy rights requests, and entering into
            any required contracts with us as a service provider or contractor.
            We will support you in meeting those obligations as described in our{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>{" "}
            and in any separate written agreement between us.
          </p>
        </section>

        {/* 9) Disclaimers */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">9) Disclaimers</h2>
          <p className="mt-2 text-sm text-gray-800">
            THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITH ALL
            FAULTS. TO THE EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES,
            EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
            UNINTERRUPTED, ERROR FREE, OR SECURE.
          </p>
        </section>

        {/* 10) Limitation of Liability */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">10) Limitation of Liability</h2>
          <p className="mt-2 text-sm text-gray-800">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE
            LIABLE UNDER THESE TERMS FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
            REVENUE, DATA, OR GOODWILL, EVEN IF ADVISED OF THE POSSIBILITY OF
            SUCH DAMAGES.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ALL
            CLAIMS RELATING TO THE SERVICE IN ANY TWELVE (12) MONTH PERIOD WILL
            NOT EXCEED THE AMOUNTS PAID BY YOUR ORGANIZATION TO US FOR THE
            SERVICE DURING THAT PERIOD, OR, IF NO AMOUNTS WERE PAID, ONE
            HUNDRED U.S. DOLLARS (US $100). THIS LIMITATION DOES NOT APPLY TO
            LIABILITY THAT CANNOT BE LIMITED UNDER APPLICABLE LAW, SUCH AS
            LIABILITY FOR GROSS NEGLIGENCE OR WILLFUL MISCONDUCT.
          </p>
        </section>

        {/* 11) Indemnification */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">11) Indemnification</h2>
          <p className="mt-2 text-sm text-gray-800">
            You agree to indemnify, defend, and hold us and our officers,
            directors, employees, and agents harmless from and against any
            third party claims, damages, losses, and expenses (including
            reasonable attorneys&apos; fees) arising out of or related to:
          </p>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>Your misuse of the Service or violation of these Terms;</li>
            <li>
              Your violation of law or food program rules in connection with
              your use of the Service; or
            </li>
            <li>
              Your processing of personal information in the Service, including
              Your Content, except to the extent the issue is caused by our
              failure to comply with these Terms or applicable law.
            </li>
          </ul>
        </section>

        {/* 12) Termination */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">12) Termination</h2>
          <p className="mt-2 text-sm text-gray-800">
            You may stop using the Service at any time. We may suspend or
            terminate your access to the Service (or to specific accounts) if
            you materially violate these Terms, if necessary for security or
            system integrity, or if required by law. Where reasonable, we will
            provide notice to the primary contact for your organization before
            terminating access.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            Upon termination or expiration of your organization&apos;s access, we
            will handle Your Content in accordance with our{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>{" "}
            and any applicable agreement with your organization, including any
            requirements to retain certain records for food program, audit, or
            legal purposes.
          </p>
        </section>

        {/* 13) Governing Law; Dispute Resolution */}
        <section className="px-4 md:px-6 py-5 border-b border-brand-100">
          <h2 className="text-lg font-semibold">
            13) Governing Law; Dispute Resolution
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            These Terms are governed by the laws of the State of California,
            without regard to its conflict of law principles. Any disputes
            arising out of or relating to these Terms or the Service will be
            brought exclusively in the state or federal courts located in Los
            Angeles County, California, and the parties consent to the personal
            jurisdiction and venue of those courts.
          </p>
        </section>

        {/* 14) Changes to These Terms; Contact */}
        <section className="px-4 md:px-6 py-5">
          <h2 className="text-lg font-semibold">
            14) Changes to These Terms; Contact
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            We may update these Terms from time to time. If we make material
            changes, we will update the &quot;Last updated&quot; date above and may
            provide additional notice, such as by email or an in app message.
            Your continued use of the Service after the updated Terms take
            effect constitutes your acceptance of them.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            Questions about these Terms? Email{" "}
            <a href="mailto:CONTACT_EMAIL" className="underline">
              CONTACT_EMAIL
            </a>{" "}
            or write to:
          </p>
          <address className="mt-2 not-italic text-sm text-gray-800">
            {/* Replace these placeholders with your actual legal name and address */}
            LEGAL_NAME<br />
            Attn: Legal / Terms of Service<br />
            City, State, ZIP<br />
            United States
          </address>
        </section>
      </div>
    </div>
  );
}
