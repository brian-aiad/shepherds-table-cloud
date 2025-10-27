// src/pages/UsagePolicy.jsx
import { Link } from "react-router-dom";

export default function UsagePolicy() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-[color:var(--brand-700)]">
            Shepherds Table Cloud — Usage Policy
          </h1>
          <p className="text-sm text-gray-500">Effective Date: January 1, 2025</p>
        </header>

        <div className="prose prose-sm sm:prose max-w-none">
          <h2>1. Purpose</h2>
          <p>
            Shepherds Table Cloud (“the Platform”) is a secure system for authorized staff and volunteers
            of participating food banks to log client visits, generate reports, and manage USDA / EFAP data.
            This policy outlines acceptable use of the Platform.
          </p>

          <h2>2. Authorized Access</h2>
          <ul>
            <li>Only approved users with valid login credentials may access the Platform.</li>
            <li>Use your assigned organization account.</li>
            <li>Keep login credentials private and secure.</li>
            <li>Immediately report unauthorized access to administrators.</li>
          </ul>

          <h2>3. Data Accuracy and Integrity</h2>
          <ul>
            <li>Enter accurate and complete information when recording client data or visits.</li>
            <li>Avoid entering false, duplicate, or misleading data.</li>
            <li>Respect the confidentiality of all client and organization data.</li>
          </ul>

          <h2>4. Confidentiality</h2>
          <p>
            All data within the Platform, including client personal information and visit history, is confidential
            and may only be used for authorized program purposes. Sharing screenshots, exports, or reports with
            unauthorized individuals is prohibited.
          </p>

          <h2>5. Prohibited Use</h2>
          <ul>
            <li>Do not attempt to bypass security features or gain unauthorized access.</li>
            <li>Do not share your account or impersonate another user.</li>
            <li>Do not use the system for personal, commercial, or non-program-related activities.</li>
          </ul>

          <h2>6. Monitoring and Enforcement</h2>
          <p>
            System usage may be logged for audit and compliance purposes. Violations may result in suspension
            or termination of access.
          </p>

          <h2>7. Updates</h2>
          <p>
            Shepherds Table Cloud may update this policy periodically. Continued use of the Platform indicates
            agreement with the latest version.
          </p>

          <h2>8. Contact</h2>
          <p>
            For questions or to report misuse, contact your organization’s administrator or text{" "}
            <a
                href="sms:+13106256844"
                className="text-[color:var(--brand-700)] hover:text-[color:var(--brand-800)] font-medium"
            >
                (310) 625-6844
            </a>
            .
            </p>


          <p className="mt-8">
            <Link to="/login" className="text-[color:var(--brand-700)] hover:text-[color:var(--brand-800)]">
              ← Back to sign-in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
