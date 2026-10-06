import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - TradeNext",
  description:
    "Terms of Service for TradeNext. TradeNext is a tool, not an adviser — market data and AI-generated analyses are informational only.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white sm:text-5xl mb-6">
          Terms of Service
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg mb-12">
          These terms govern your use of TradeNext — a market-data analytics platform for NSE (India)
          securities. By accessing or using the service, you agree to these terms.
        </p>

        <div className="space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Acceptance of Terms
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              By creating an account, subscribing to alerts, or otherwise using TradeNext, you confirm
              that you have read, understood, and agreed to these terms. You must be at least 18 years of
              age to use the service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Description of Service
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              TradeNext provides NSE market data, screening and analytics tools, portfolio management,
              capital-gains calculations, swing signals, and AI-generated recommendations and analyses.
              The service is operated as a tool for information and convenience.
            </p>
          </section>

          <section className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Not Financial Advice
            </h2>
            <p className="text-gray-700 dark:text-gray-300">
              <strong>TradeNext is a tool, not an adviser.</strong> Nothing on the site — including
              recommendations, swing signals, AI analyses, targets, and stop-loss levels — constitutes
              investment, financial, legal, or tax advice, nor a personalised recommendation for any
              specific person. Signals are algorithmic outputs; they may be wrong, delayed, or unsuitable
              for your circumstances. Past performance does not guarantee future results. You alone are
              responsible for your investment decisions, and you should consider consulting a qualified
              financial adviser before acting on anything you see here.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Data Disclaimers
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Market data, prices, corporate actions, and other information are sourced from third-party
              providers such as NSE India and may be delayed or contain errors. We do not warrant the
              accuracy, completeness, or timeliness of any data shown. Screeners, backtests, and analytics
              are provided &quot;as is&quot; for research purposes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Accounts
            </h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400">
              <li>You must provide accurate account details and keep them up to date.</li>
              <li>You are responsible for safeguarding your credentials. Do not share them.</li>
              <li>One account per person unless otherwise approved by the operator.</li>
              <li>Accounts may be suspended for breach of these terms or misuse.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Acceptable Use
            </h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 dark:text-gray-400">
              <li>Use the service only for lawful personal purposes.</li>
              <li>Do not attempt to circumvent rate limits, access controls, or other safeguards.</li>
              <li>Do not scrape or bulk-extract data beyond reasonable personal use.</li>
              <li>Do not resell or redistribute market-data feeds obtained through the service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Intellectual Property
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              The TradeNext interface, branding, and original content are the property of the operator.
              Underlying market data belongs to its respective owners and is displayed under their terms.
              You may not copy or redistribute the service or its content beyond reasonable personal use.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Service Availability
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              The service is provided &quot;as is&quot; and &quot;as available&quot;. Access may be
              interrupted for maintenance, provider outages, market hours, or operational reasons without
              notice. We do not guarantee uninterrupted or error-free operation.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Limitation of Liability
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              To the maximum extent permitted by applicable law, the operator shall not be liable for any
              direct, indirect, incidental, special, or consequential losses — including trading or
              investment losses — arising from your use of, or inability to use, the service or reliance on
              any data, recommendation, or analysis it provides.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Termination
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              You may close your account at any time. The operator may suspend or terminate access for
              violation of these terms, abusive behaviour, or as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Changes to These Terms
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              We may update these terms from time to time. Continued use of the service after changes are
              posted constitutes acceptance of the revised terms. This page is the authoritative copy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Governing Law
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              These terms are governed by the laws of India.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Contact
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Questions about these terms? Email us at{" "}
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