const APP_STORE_URL = 'https://apps.apple.com/app/autostrike-golf/id6762587973';

export function onRequestGet({ request }) {
  const url = new URL(request.url);
  const parameters = [...url.searchParams];
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  };
  if (parameters.length !== 1 || parameters[0][0] !== 'code'
      || !/^[A-Z0-9]{6,32}$/i.test(parameters[0][1])) {
    return new Response('This game invite is invalid. Scan the QR code on the host’s phone again.', {
      status: 400,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // iOS handles associated universal links before making this web request.
  // A browser reaching this route needs the app; the host's QR can be scanned
  // again after installation to join the same game.
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: APP_STORE_URL },
  });
}
