import { PLATFORM } from "@/lib/business"

/** Shared look for the Terms and Privacy pages. */
export function LegalDoc({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="rounded-xl border bg-background p-6 sm:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {PLATFORM.name} · last updated {updated}
      </p>
      <div className="mt-6 space-y-6 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </article>
  )
}

export function Contact() {
  return (
    <p>
      Questions? Email{" "}
      <a href={`mailto:${PLATFORM.email}`} className="font-medium text-primary underline-offset-2 hover:underline">
        {PLATFORM.email}
      </a>
      . {PLATFORM.name}, {PLATFORM.address}.
    </p>
  )
}
