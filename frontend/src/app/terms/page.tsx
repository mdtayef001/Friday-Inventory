import type { Metadata } from "next"
import { Contact, LegalDoc } from "@/components/legal"
import { StandalonePage } from "@/components/standalone"
import { PLATFORM } from "@/lib/business"

export const metadata: Metadata = { title: "Terms of Service" }

// Plain-language terms that match how the app works. Have a lawyer read them before launch.
export default function TermsPage() {
  const us = PLATFORM.name
  return (
    <StandalonePage wide>
      <LegalDoc title="Terms of Service" updated="October 21, 2026">
        <p>
          These terms are the agreement between {us} (&ldquo;we&rdquo;) and the business using it (&ldquo;you&rdquo;). By logging in, you
          agree to them. The business owner agrees on behalf of the business and everyone they give an account to.
        </p>

        <section>
          <h2>What you get</h2>
          <p>
            An online app to manage stock, sales, purchases, rentals, orders and your team, for every shop and warehouse you add. Every
            feature is included in one monthly price.
          </p>
        </section>

        <section>
          <h2>Price, trial and paying</h2>
          <ul>
            <li>New businesses may get a free trial. Its length is shown when your account is made.</li>
            <li>After that you pay the monthly price shown on your Billing page, in advance, for one month or more at a time.</li>
            <li>We never charge you automatically. Nothing is taken from your card or account unless you pay.</li>
            <li>If we change the price, the new price applies to payments made after the change, not to months you&apos;ve already paid for.</li>
            <li>Payments by bKash, Nagad, Rocket, Upay or bank are checked by us before your months start.</li>
            <li>Months already paid for are not refunded, except where the law requires it.</li>
          </ul>
        </section>

        <section>
          <h2>When access ends</h2>
          <p>
            If your trial or paid months run out, the business locks: your team can&apos;t use it, but the owner can still log in to pay,
            download all the data, or ask for it to be deleted. Nothing is deleted because you stopped paying. You can cancel at any time
            on the Billing page; you keep access until the end of what you paid for.
          </p>
        </section>

        <section>
          <h2>Your data</h2>
          <ul>
            <li>Everything your business puts in the app belongs to you. We don&apos;t sell it or use it for anything except running the app for you.</li>
            <li>The owner can download all of it at any time, as spreadsheets, even while the business is locked.</li>
            <li>
              The owner can ask for the business to be deleted. Once we approve it, the business locks and is deleted for good 30 days
              later. Until then you can change your mind. After that it can&apos;t be brought back.
            </li>
            <li>You&apos;re responsible for keeping your own business and tax records for as long as the law requires. Download them before deleting.</li>
          </ul>
        </section>

        <section>
          <h2>Your responsibilities</h2>
          <ul>
            <li>Keep passwords private, and give accounts only to people you trust with your business.</li>
            <li>Use the app only for lawful business, and only with information you have the right to use, such as your customers&apos; phone numbers.</li>
            <li>The numbers in the app (stock, sales, profit, what you owe) are only as correct as what your team enters. Check them before relying on them for tax or legal purposes.</li>
          </ul>
        </section>

        <section>
          <h2>Availability</h2>
          <p>
            We work to keep the app running and your data safe, with regular backups. The app needs an internet connection. We can&apos;t
            promise it will never be down, and we aren&apos;t liable for lost sales or profits while it is. Our total liability is limited
            to what you paid us in the last three months.
          </p>
        </section>

        <section>
          <h2>Suspending accounts</h2>
          <p>
            We may suspend a business that breaks these terms, misuses the app or doesn&apos;t pay for a payment it sent us. We&apos;ll tell
            the owner why. Suspending doesn&apos;t delete anything.
          </p>
        </section>

        <section>
          <h2>Changes and law</h2>
          <p>
            If we change these terms, we&apos;ll update the date above and tell owners in the app before the change applies. These terms are
            governed by the laws of Bangladesh.
          </p>
        </section>

        <Contact />
      </LegalDoc>
    </StandalonePage>
  )
}
