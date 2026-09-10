import { buttonClassName } from "@/components/ui/button";

/**
 * A plain `<a>`, not a client component with an onClick: this has to be a
 * real top-level navigation for the OAuth redirect chain to work at all, and
 * a server component that renders a link needs no "use client" to do it.
 *
 * `next` rides along as a query parameter into /api/auth/google, which moves
 * it into the state cookie for the callback to read back — see that route for
 * why it cannot simply be part of the callback URL instead.
 */
export function GoogleSignInButton({
  next,
  invite,
  label = "Googleでログイン",
}: {
  next: string;
  invite?: string;
  label?: string;
}) {
  const params = new URLSearchParams({ next });
  if (invite) params.set("invite", invite);
  const href = `/api/auth/google?${params.toString()}`;

  return (
    <a href={href} className={buttonClassName("secondary", "md")}>
      <GoogleGlyph />
      {label}
    </a>
  );
}

/** Google's own four-colour "G", inlined so this has no icon-font or asset dependency. */
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.6 2.3-7.2 2.3-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C40.9 36.3 44 30.8 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}
