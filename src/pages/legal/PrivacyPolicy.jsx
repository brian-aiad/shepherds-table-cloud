// src/pages/PrivacyPolicy.jsx
import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  const updated = "December 1, 2025";

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-600">Last updated: {updated}</p>
      </header>

      <div className="rounded-2xl border border-brand-100 bg-white shadow-soft overflow-hidden">
        {/* Notice at Collection */}
        <section className="px-4 md:px-6 py-4 border-b border-brand-100 bg-brand-50/60">
          <h2 className="text-lg font-semibold">
            Notice at Collection (California)
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            This notice explains the categories of personal information we
            collect, why we collect it, how long we keep it, and how we use it.
            We use this information to register clients, verify eligibility for
            food programs (for example EFAP / USDA), log visits, and generate
            required reports for partner organizations and agencies. We also use
            certain information to operate and secure the application for staff
            and volunteers who log in.
          </p>

          <div className="mt-3 rounded-xl border border-brand-100 bg-white px-3 py-3 text-xs md:text-sm text-gray-800">
            <p className="font-semibold">Summary of categories and purposes:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                <b>Client identifiers and household information</b>{" "}
                (for example name, phone, date of birth, ZIP code, county,
                household size) used to create and maintain client records,
                verify program eligibility, prevent duplicate records, and
                generate required reports.
              </li>
              <li>
                <b>Client address information</b> (street, city, ZIP, county)
                used to assign clients to locations, support eligibility based
                on service area, and standardize addresses (for example through
                Mapbox lookup).
              </li>
              <li>
                <b>Program and visit data</b> (visit dates and times, location,
                whether a visit is the first USDA visit in a month, and similar
                fields) used to document services provided and to meet federal,
                state, or food bank reporting requirements.
              </li>
              <li>
                <b>Organization and location context</b> (selected organization,
                selected distribution site, staff role) used so staff and
                volunteers only see data for the organizations and locations
                they work with.
              </li>
              <li>
                <b>Account and device information for staff and volunteers</b>{" "}
                (for example login email, authentication identifiers from
                Firebase, IP address, browser type, and timestamps) used to
                operate, secure, and troubleshoot the service.
              </li>
            </ul>
            <p className="mt-2">
              We do not collect Social Security Numbers, immigration status,
              payment card numbers, or precise GPS geolocation through this
              service. We do not sell personal information and we do not share
              personal information for cross context behavioral advertising as
              those terms are used in the California Consumer Privacy Act
              (CCPA), as amended by the California Privacy Rights Act (CPRA).
            </p>
            <p className="mt-2">
              We retain client and visit records for as long as needed to
              support ongoing program operations and to meet record keeping
              requirements for food programs such as EFAP and TEFAP, which
              currently require records to be kept for at least three years
              from the close of the federal fiscal year to which they relate,
              or longer if an audit, investigation, or other legal requirement
              is still open. Staff and volunteer account records are retained
              while the account is active and for a reasonable period afterward
              for security, audit, and backup purposes.
            </p>
          </div>
        </section>

        {/* Table of Contents */}
        <nav className="px-4 md:px-6 py-3 text-sm border-b border-brand-100 bg-white">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <a className="text-brand-800 hover:underline" href="#what-we-collect">
                What we collect
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#how-we-use">
                How we use information
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#sharing">
                How we share information
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#ccpa">
                Your California privacy rights
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#security">
                Security
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#retention">
                Retention
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#children">
                Children’s privacy
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#changes">
                Changes to this policy
              </a>
            </li>
            <li>
              <a className="text-brand-800 hover:underline" href="#contact">
                Contact us
              </a>
            </li>
          </ul>
        </nav>

        {/* What we collect */}
        <section
          id="what-we-collect"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">What we collect</h2>
          <p className="mt-2 text-sm text-gray-800">
            We collect information directly from you or your volunteers when
            creating a client record or logging a visit, and automatically from
            your device to help keep the service secure. The categories of
            personal information we collect include:
          </p>
          <ul className="mt-3 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>
              <b>Identifiers</b> (for example name, phone number, email if
              provided).
            </li>
            <li>
              <b>Demographic and household information</b> (for example date of
              birth, ZIP code, county, household size, and similar
              program related information that your organization decides to
              track).
            </li>
            <li>
              <b>Addresses</b> (street address, city, ZIP code, county; some
              addresses may be looked up or standardized using Mapbox or similar
              tools).
            </li>
            <li>
              <b>Program and visit data</b> (for example visit dates and times,
              location, whether this is the first USDA visit in a month, and
              other fields needed for sign in sheets and reports).
            </li>
            <li>
              <b>Organization context</b> (your selected organization, selected
              location, and your role within the app).
            </li>
            <li>
              <b>Account, device, and usage information</b> (for example login
              email, authentication identifiers from Firebase, IP address,
              browser and device information, and timestamps) used for
              security, troubleshooting, and abuse prevention.
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-700">
            We do not collect Social Security Numbers, immigration status,
            government identification numbers, payment card numbers, or precise
            GPS geolocation through this service. We do not sell personal
            information and we do not use third party behavioral advertising.
          </p>
        </section>

        {/* How we use */}
        <section
          id="how-we-use"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">How we use information</h2>
          <ul className="mt-2 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>To register clients and log visits for service delivery.</li>
            <li>
              To generate EFAP / USDA sign in forms and monthly or annual
              reports needed by your food bank or agency partners.
            </li>
            <li>
              To maintain accurate records and prevent duplicate client
              profiles.
            </li>
            <li>
              To operate, secure, troubleshoot, and improve the application,
              including monitoring for abuse or unauthorized access.
            </li>
            <li>
              To comply with applicable laws, regulations, audit requirements,
              and program rules.
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-800">
            We do not use client information for unrelated purposes such as
            immigration enforcement, credit reporting, debt collection, or
            general consumer marketing. If your organization chooses to export
            data from the app and use it in other systems, that use is governed
            by your organization&apos;s own policies and notices.
          </p>
        </section>

        {/* Sharing */}
        <section
          id="sharing"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">How we share information</h2>
          <p className="mt-2 text-sm text-gray-800">
            We share information only as needed to operate the service, comply
            with the law, or with your direction or consent:
          </p>
          <ul className="mt-3 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>
              <b>Service providers</b> that process data on our behalf, such as:
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>Google Firebase (Authentication, Firestore, Storage).</li>
                <li>Mapbox or similar tools (address lookup and mapping).</li>
                <li>
                  Infrastructure, logging, analytics with privacy safeguards,
                  and email providers (for support and system messages).
                </li>
              </ul>
            </li>
            <li>
              <b>Reporting recipients</b> (for example your food bank, regional
              or state agencies, or similar partners) as needed to complete
              required program forms and reports that you generate in the app.
            </li>
            <li>
              <b>Legal and safety</b> when we believe disclosure is required by
              law or is reasonably necessary to protect the rights, safety, or
              property of clients, staff, volunteers, or the service.
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-700">
            We do not sell personal information and we do not share personal
            information for cross context behavioral advertising. When we act as
            a service provider or contractor to your organization, we use client
            data only as allowed by our agreement with that organization and
            applicable law.
          </p>
        </section>

        {/* CCPA/CPRA Rights */}
        <section
          id="ccpa"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">
            Your California privacy rights (CCPA / CPRA)
          </h2>
          <p className="mt-2 text-sm text-gray-800">
            If you are a California resident, you may have the following rights
            with respect to your personal information, subject to certain
            exceptions:
          </p>
          <ul className="mt-3 text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>
              <b>Right to know and access</b> the categories and specific pieces
              of personal information we collect, use, and disclose about you.
            </li>
            <li>
              <b>Right to delete</b> personal information, subject to our need
              to retain certain information to comply with food program rules,
              audits, and other legal obligations.
            </li>
            <li>
              <b>Right to correct</b> inaccurate personal information.
            </li>
            <li>
              <b>Right to opt out</b> of the sale or sharing of personal
              information. We do not sell personal information and we do not
              share personal information for cross context behavioral
              advertising.
            </li>
            <li>
              <b>Right to limit the use of sensitive personal information.</b>{" "}
              We do not intentionally collect CPRA defined categories such as
              Social Security Numbers, financial account numbers with access
              codes, or precise geolocation from clients. For staff and
              volunteers with accounts, we collect login credentials and use
              them only to provide secure access to the service, not to create
              profiles unrelated to program operations.
            </li>
            <li>
              <b>Right not to be discriminated against</b> for exercising your
              privacy rights.
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-800">
            For client intake and visit records, we usually act as a service
            provider or contractor to your local organization. In many cases,
            your local food bank or agency is the entity that decides what data
            to collect and how long to keep it. If you want to exercise privacy
            rights regarding your client record, it is usually best to contact
            the organization that serves you directly. We will support that
            organization in responding to your request as allowed by law and our
            agreement with them.
          </p>
          <p className="mt-3 text-sm text-gray-800">
            For our own account users (for example staff or volunteers who log
            in to this service), you can exercise your rights by emailing{" "}
            <a href="mailto:CONTACT_EMAIL" className="underline">
              CONTACT_EMAIL
            </a>
            . We will verify your request as required by law and respond within
            applicable timelines. We may not be able to delete or fully remove
            information that we are required to keep for food program
            recordkeeping, audit, or other legal reasons. When that happens, we
            will limit our use of that information to those required purposes.
          </p>
        </section>

        {/* Security */}
        <section
          id="security"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">Security</h2>
          <p className="mt-2 text-sm text-gray-800">
            We implement reasonable administrative, technical, and physical
            safeguards to protect personal information, including role based
            access controls, encrypted transport, and Firebase security rules.
            No system can be completely secure, and we cannot guarantee perfect
            security. You are responsible for keeping your login credentials
            confidential and limiting access to authorized staff and volunteers.
          </p>
        </section>

        {/* Retention */}
        <section
          id="retention"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">Retention</h2>
          <p className="mt-2 text-sm text-gray-800">
            We retain client and visit records for as long as reasonably needed
            to support ongoing food program operations and to meet federal,
            state, and local record keeping requirements. For programs such as
            EFAP and TEFAP, this usually means at least three years from the
            close of the federal fiscal year to which the records relate, or
            longer if an audit, investigation, or other legal requirement is
            still open. We may retain backup copies for a limited time for
            business continuity and disaster recovery.
          </p>
          <p className="mt-2 text-sm text-gray-800">
            If you or your organization closes an account or requests deletion,
            we will delete or de identify personal information when it is no
            longer needed for program, audit, or legal purposes. Reports that
            you have exported from the app are outside our control and are
            governed by your organization&apos;s own policies.
          </p>
        </section>

        {/* Children */}
        <section
          id="children"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">Children’s privacy</h2>
          <p className="mt-2 text-sm text-gray-800">
            This service is designed for use by food banks, pantries, and other
            organizations and their authorized staff and volunteers. It is not
            directed to children under 13, and we do not knowingly create user
            accounts for minors. Client household records may include
            information about children that is provided by an adult household
            member solely for program eligibility and record keeping purposes.
          </p>
        </section>

        {/* Changes */}
        <section
          id="changes"
          className="px-4 md:px-6 py-5 border-b border-brand-100"
        >
          <h2 className="text-lg font-semibold">Changes to this policy</h2>
          <p className="mt-2 text-sm text-gray-800">
            We may update this policy from time to time to reflect changes in
            our practices, the law, or the services we provide. If we make
            material changes, we will post the updated policy in the app and
            adjust the “Last updated” date above. In some cases we may provide
            additional notice, such as by email or an in app message.
          </p>
        </section>

        {/* Contact */}
        <section id="contact" className="px-4 md:px-6 py-5">
          <h2 className="text-lg font-semibold">Contact us</h2>
          <p className="mt-2 text-sm text-gray-800">
            Questions or privacy requests? Email{" "}
            <a href="mailto:CONTACT_EMAIL" className="underline">
              CONTACT_EMAIL
            </a>{" "}
            or write to:
          </p>
          <address className="mt-2 not-italic text-sm text-gray-800">
            {/* Replace the placeholders below with your actual entity name and address */}
            Shepherds Table Cloud<br />
            Attn: Privacy<br />
            City, State, ZIP<br />
            United States
          </address>
          <p className="mt-4 text-xs text-gray-600">
            By using this service, you also agree to our{" "}
            <Link className="underline" to="/terms">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
