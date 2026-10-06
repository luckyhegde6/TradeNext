import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - TradeNext",
  description:
    "How TradeNext collects, uses, and protects your information. Minimal, first-party privacy policy.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white sm:text-5xl mb-6">
          Privacy Policy
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg mb-12">
          This policy explains what information TradeNext collects, how it is used, and the choices you
          have. It applies to the public site and the services available through it.
        </p>

        <div className="space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Information We Collect
            </h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400">
              <li>
                <strong className="text-gray-800 dark:text-gray-200">Account information</strong> — name,
                email address, a securely hashed password, and role. A session cookie (httpOnly,
                SameSite=Strict) keeps you signed in.
              </li>
              <li>
                <strong className="text-gray-800 dark:text-gray-200">Data you provide</strong> — portfolio
                transactions and holdings, watchlists, alerts, alert rules and channels, and your Telegram
                chat ID for bot delivery.
              </li>
              <li>
                <strong className="text-gray-800 dark:text-gray-200">Contact form</strong> — your name,
                email address, subject, and message when you contact us. Submissions are stored as
                notifications for the site operator and recorded in the audit log.
              </li>
              <li>
                <strong className="text-gray-800 dark:text-gray-200">Server-side logs</strong> — request
                metadata and audit entries used for security and troubleshooting. A small in-memory mirror
                may be used to keep the service resilient during database outages; it is retained on a
                short window (14 days).
              </li>
              <li>
                <strong className="text-gray-800 dark:text-gray-200">AI analysis inputs</strong> — when you
                request an AI-driven analysis (such as alerts or watchlist insights), the symbols and data
                you submit may be sent to a configured AI provider to generate the analysis.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              How We Use Your Information
            </h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400">
              <li>To operate and personalise the service — portfolios, alerts, recommendations, and watchlists.</li>
              <li>To deliver Telegram bot alerts and updates you have subscribed to.</li>
              <li>To respond to contact requests and support inquiries.</li>
              <li>To monitor availability, investigate faults, and prevent abuse.</li>
              <li>To generate AI analyses you explicitly request.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Sharing of Information
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-3">
              We do not sell or rent your personal information. Your information is shared only in the
              following limited circumstances:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400">
              <li>
                <strong className="text-gray-800 dark:text-gray-200">AI providers</strong> — analysis
                inputs are sent to the configured AI provider solely to produce the analysis you requested.
              </li>
              <li>
                <strong className="text-gray-800 dark:text-gray-200">Google Sheets (operator-only)</strong> —
                an optional admin feature may export anonymous recommendation, screener, and tracker rows to
                a spreadsheet owned by the operator. No personal user information is included.
              </li>
              <li>
                <strong className="text-gray-800 dark:text-gray-200">Legal compliance</strong> — when we
                are required to do so by law or to protect the rights and safety of users and the service.
              </li>
            </ul>
            <p className="text-gray-600 dark:text-gray-400 mt-3">
              Market data shown on the site comes from third-party sources (such as NSE India). The data
              itself remains the property of its respective owners.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Data Retention
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Account data is retained while your account is active and for a reasonable period after
              closure to meet legal and operational obligations. Contact messages remain in the operator&apos;s
              notification inbox until reviewed. Server and audit logs are retained on a rolling basis in
              line with operational needs and the 14-day resilience mirror window.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Your Rights
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              You may request access to, correction of, or deletion of the personal information we hold
              about you, and you may close your account at any time. To exercise any of these rights,
              contact us using the details below and we will respond within a reasonable time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Security
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              We use industry-standard measures: encryption in transit (TLS), hashed passwords, httpOnly
              session cookies, and role-based access control. No method of transmission or storage is
              completely secure, but we work to protect your information to a reasonable standard.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Changes to This Policy
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              We may update this policy from time to time to reflect changes in the service or the law.
              Material changes will be reflected on this page, which is the authoritative copy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Contact Us
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Questions about this policy or your data? Email us at{" "}
              <a
                href="mailto:luckyhegdedev+tradenext@gmail.com"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                luckyhegdedev+tradenext@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}