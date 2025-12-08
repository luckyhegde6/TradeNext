// app/docs/page.tsx (client component)
'use client';
import { useEffect } from 'react';

export default function DocsPage() {
  useEffect(() => {
    // dynamically inject swagger-ui from unpkg
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/swagger-ui-dist@4/swagger-ui-bundle.js';
    script.async = true;
    document.head.appendChild(script);

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/swagger-ui-dist@4/swagger-ui.css';
    document.head.appendChild(css);

    script.onload = async () => {
      // @ts-expect-error - SwaggerUIBundle is loaded dynamically
      window.ui = (window as Window & { SwaggerUIBundle: any }).SwaggerUIBundle({
        url: '/api/openapi',
        dom_id: '#swagger',
      });
    };
    return () => {
      document.head.removeChild(script);
      document.head.removeChild(css);
    };
  }, []);

  return (
    <main style={{ padding: 16 }}>
      <h1>TradeNext API Docs</h1>
      <p style={{ fontSize: 13, color: '#666' }}>
        To view docs set cookie <code>admin_key=YOUR_ADMIN_KEY</code> (browser console) or send header{' '}
        <code>x-admin-key</code>.
      </p>
      <div id="swagger" />
    </main>
  );
}
