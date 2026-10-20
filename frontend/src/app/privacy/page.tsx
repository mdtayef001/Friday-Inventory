import type { Metadata } from "next"
import { Contact, LegalDoc } from "@/components/legal"
import { StandalonePage } from "@/components/standalone"
import { PLATFORM } from "@/lib/business"

export const metadata: Metadata = { title: "Privacy Policy" }

// Plain-language policy that matches what the app stores and who it shares it with. Have a lawyer read it before launch.
export default function PrivacyPage() {
  const us = PLATFORM.name
  return (
    <StandalonePage wide>
      <LegalDoc title="Privacy Policy" updated="October 21, 2026">
        <p>This explains what {us} keeps about businesses, their teams and their customers, why, and what you can do about it.</p>

        <section>
          <h2>What we keep</h2>
          <ul>
            <li>Accounts: names, emails, roles, the shops people work at, and a scrambled (hashed) password we can&apos;t read.</li>
            <li>Your business records: products, stock, sales, receipts, purchases, suppliers, rentals, orders, transfers and the activity log of who did what.</li>
            <li>Your customers and suppliers, as your team enters them: names, phone numbers, emails and addresses.</li>
            <li>Subscription payments: amounts, dates and transaction IDs. Card details are handled by SSLCommerz; we never see them.</li>
            <li>When each person last logged in, to keep accounts secure.</li>
          </ul>
        </section>

        <section>
          <h2>Why</h2>
          <p>
            Only to run the app for your business: showing your records to the right people on your team, receipts and tracking links you
            choose to send, billing, security, and helping when you contact us. We don&apos;t sell data or show ads.
          </p>
        </section>

        <section>
          <h2>Who else handles it</h2>
          <ul>
            <li>Vercel: runs the app.</li>
            <li>Supabase: stores the database, in Singapore.</li>
            <li>SSLCommerz: takes online payments.</li>
            <li>Our email provider: sends password reset emails.</li>
          </ul>
          <p>Each only gets what it needs for its part. We share data with authorities only when Bangladeshi law requires it.</p>
        </section>

        <section>
          <h2>Your customers</h2>
          <p>
            For your customers&apos; details, your business decides what to collect and is responsible for having the right to use it. We
            keep it for you and use it only to run the app. A receipt or order tracking link shows only that receipt or order, to whoever
            has the link.
          </p>
        </section>

        <section>
          <h2>How long we keep it</h2>
          <p>
            For as long as the business has an account, including while it&apos;s locked for not paying, so nothing is lost if you come
            back. When the owner asks for the business to be deleted and we approve it, everything is deleted 30 days later. We keep only a
            short record that it was deleted: the business name, the owner&apos;s email, and when it was asked for and done. Backups are
            kept for a short time and then removed.
          </p>
        </section>

        <section>
          <h2>Your choices</h2>
          <ul>
            <li>Owners can download all their business&apos;s data at any time, from Billing or Business settings.</li>
            <li>Owners and managers can correct or remove people, customers and records in the app.</li>
            <li>Owners can ask for the whole business to be deleted from Business settings.</li>
            <li>Anyone with an account can reset their password from the log in page.</li>
          </ul>
        </section>

        <section>
          <h2>Keeping it safe</h2>
          <p>
            Connections are encrypted, passwords are stored hashed, each business sees only its own data, and people see only the shops
            and features their owner allows. If something ever goes wrong with your data, we&apos;ll tell the owner promptly.
          </p>
        </section>

        <Contact />
      </LegalDoc>
    </StandalonePage>
  )
}
