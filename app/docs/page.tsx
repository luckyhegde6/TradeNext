// app/docs/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

export default function DocsPage() {
  const { data: session, status } = useSession();
  const [authorized, setAuthorized] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  const isAdmin = session?.user?.role?.toLowerCase() === 'admin';

  useEffect(() => {
    if (status === 'unauthenticated') {
      setError('Please sign in to access API documentation');
      return;
    }

    if (status === 'authenticated' && !isAdmin) {
      setError('Access denied. Admin only.');
      return;
    }

    if (status === 'authenticated' && isAdmin) {
      setAuthorized(true);
      
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
        window.ui = (window as Window & { SwaggerUIBundle: unknown }).SwaggerUIBundle({
          url: '/api/openapi',
          dom_id: '#swagger',
          persistAuthorization: true,
          onComplete: () => {
            // Set token if already entered
            if (token) {
              // @ts-expect-error - Swagger UI is loaded dynamically
              window.ui.authActions.authorize({ bearerAuth: { schema: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, value: token } });
            }
          }
        });
      };
      return () => {
        document.head.removeChild(script);
        document.head.removeChild(css);
      };
    }
  }, [status, isAdmin, token]);

  const handleAuthorize = () => {
    if (!token) {
      setError('Please enter a JWT token');
      return;
    }
    setError('');
    // @ts-expect-error - Swagger UI is loaded dynamically
    if (window.ui) {
      // @ts-expect-error - Swagger UI is loaded dynamically
      window.ui.authActions.authorize({ bearerAuth: { schema: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, value: token } });
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <div className="text-center">
            <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
            <p className="text-gray-600 mb-4">
              {error || 'API Documentation is only available for administrators.'}
            </p>
            {status === 'unauthenticated' && (
              <a href="/auth/signin" className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Sign In
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">TradeNext API Documentation</h1>
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-bold text-blue-900 mb-2">How to get your JWT token:</h3>
              <ol className="list-decimal list-inside text-sm text-blue-800 space-y-1">
                <li>Sign in to TradeNext with your admin account</li>
                <li>Open browser Developer Tools (F12)</li>
                <li>Go to <strong>Network</strong> tab</li>
                <li>Refresh the page or make any request</li>
                <li>Click on any request to TradeNext API</li>
                <li>In the request headers, find <code className="bg-blue-100 px-1 rounded">Authorization</code> header - it will look like: <code className="bg-blue-100 px-1 rounded">Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...</code></li>
                <li>Copy the entire token (including "Bearer " prefix) or just the token part</li>
              </ol>
            </div>
            <p className="text-gray-600 mb-4">
              Enter your JWT token below to test authenticated API endpoints. Only admin users can access this documentation.
            </p>
            <div className="flex gap-4">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter JWT token (e.g., eyJ...) or full 'Bearer ...'"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleAuthorize}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Authorize
              </button>
            </div>
            {error && <p className="text-red-500 mt-2">{error}</p>}
          </div>
        <div id="swagger" />
      </div>
    </div>
  );
}
