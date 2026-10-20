/**
 * The platform's WhatsApp username as a link that opens a chat with it (wa.me/<username>),
 * in a new tab. Usable from server and client components alike.
 */
export function WhatsAppLink({ username, className }: { username: string; className?: string }) {
  return (
    <a
      href={`https://wa.me/${encodeURIComponent(username)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-medium text-primary underline underline-offset-2 hover:no-underline ${className ?? ""}`}
      title="Open a chat on WhatsApp"
    >
      {username}
    </a>
  )
}
