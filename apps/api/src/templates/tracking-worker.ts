// src/templates/tracking-worker.ts — Generates Worker script for org-level email tracking
// Enhanced with geo, device, browser, email client parsing

export function generateWorkerScript(config: {
  openPath: string
  clickPath: string
  unsubPath: string
  d1Binding: string
}): string {
  return `// Dispatch Tracking Worker
// Deployed to org's Cloudflare account for first-party email tracking
// Enhanced: captures geo, device, browser, email client data

// Lightweight UA parser (runs at edge)
function parseUA(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', device: 'desktop', emailClient: null };
  const r = { browser: 'Unknown', os: 'Unknown', device: 'desktop', emailClient: null };

  // Email clients
  if (/GoogleImageProxy/i.test(ua)) { r.emailClient = 'Gmail'; r.browser = 'Gmail'; }
  else if (/Outlook|Microsoft Office/i.test(ua)) { r.emailClient = 'Outlook'; r.browser = 'Outlook'; }
  else if (/Thunderbird/i.test(ua)) { r.emailClient = 'Thunderbird'; r.browser = 'Thunderbird'; }
  else if (/YahooMailProxy/i.test(ua)) { r.emailClient = 'Yahoo Mail'; r.browser = 'Yahoo Mail'; }

  // OS
  if (/Windows NT/i.test(ua)) r.os = 'Windows';
  else if (/Mac OS X/i.test(ua)) r.os = 'macOS';
  else if (/iPhone|iPad/i.test(ua)) r.os = 'iOS';
  else if (/Android/i.test(ua)) r.os = 'Android';
  else if (/Linux/i.test(ua)) r.os = 'Linux';

  // Browser (if not email client)
  if (!r.emailClient) {
    if (/Edg\\//i.test(ua)) r.browser = 'Edge';
    else if (/OPR\\//i.test(ua)) r.browser = 'Opera';
    else if (/Chrome\\//i.test(ua)) r.browser = 'Chrome';
    else if (/Firefox\\//i.test(ua)) r.browser = 'Firefox';
    else if (/Safari\\//i.test(ua) && !/Chrome/i.test(ua)) r.browser = 'Safari';
  }

  // Device
  if (/Mobile|iPhone|Android.*Mobile/i.test(ua)) r.device = 'mobile';
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) r.device = 'tablet';

  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const ua = request.headers.get('user-agent') || '';
    const country = request.headers.get('cf-ipcountry') || '';
    const city = request.cf?.city || '';
    const parsed = parseUA(ua);

    // Open tracking — 1x1 transparent GIF
    if (path.startsWith('/${config.openPath}/')) {
      const id = path.split('/')[2];
      if (!id) return new Response('', { status: 404 });

      env.${config.d1Binding}.prepare(
        'INSERT INTO events (id, email_id, type, ip, ua, country, city, device_type, browser, os, email_client, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\\'now\\'))'
      ).bind(crypto.randomUUID(), id, 'open', ip, ua, country, city, parsed.device, parsed.browser, parsed.os, parsed.emailClient)
        .run().catch(() => {});

      const pixel = new Uint8Array([71,73,70,56,57,97,1,0,1,0,128,0,0,255,255,255,0,0,0,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
      return new Response(pixel, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Expires': '0' },
      });
    }

    // Click tracking — 302 redirect
    if (path.startsWith('/${config.clickPath}/')) {
      const id = path.split('/')[2];
      if (!id) return new Response('', { status: 404 });

      const link = await env.${config.d1Binding}.prepare(
        'SELECT original_url, email_id FROM links WHERE id = ?'
      ).bind(id).first();

      if (!link) return new Response('Not found', { status: 404 });

      const referrer = request.headers.get('referer') || '';
      env.${config.d1Binding}.prepare(
        'INSERT INTO events (id, email_id, type, link_id, ip, ua, country, city, device_type, browser, os, email_client, referrer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\\'now\\'))'
      ).bind(crypto.randomUUID(), link.email_id || '', 'click', id, ip, ua, country, city, parsed.device, parsed.browser, parsed.os, parsed.emailClient, referrer)
        .run().catch(() => {});

      return Response.redirect(link.original_url, 302);
    }

    // Unsubscribe
    if (path.startsWith('/${config.unsubPath}/')) {
      const id = path.split('/')[2];
      if (!id) return new Response('', { status: 404 });

      if (request.method === 'POST') {
        await env.${config.d1Binding}.prepare(
          'INSERT INTO events (id, email_id, type, ip, ua, country, city, device_type, browser, os, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\\'now\\'))'
        ).bind(crypto.randomUUID(), id, 'unsubscribe', ip, ua, country, city, parsed.device, parsed.browser, parsed.os)
          .run();

        return new Response(\`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px 20px;background:#fafafa"><div style="max-width:400px;margin:0 auto;background:white;padding:40px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)"><h2 style="color:#1a1a1a;margin-bottom:12px">Unsubscribed</h2><p style="color:#666">You have been successfully unsubscribed.</p></div></body></html>\`, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      return new Response(\`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px 20px;background:#fafafa"><div style="max-width:400px;margin:0 auto;background:white;padding:40px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)"><h2 style="color:#1a1a1a;margin-bottom:12px">Unsubscribe</h2><p style="color:#666;margin-bottom:24px">Click below to confirm.</p><form method="POST"><button type="submit" style="padding:12px 32px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;font-weight:500">Confirm Unsubscribe</button></form></div></body></html>\`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
`
}
