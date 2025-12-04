// app/api/openapi/route.ts
import { NextResponse } from 'next/server';

const openapi = {
    openapi: '3.0.1',
    info: {
        title: 'TradeNext API',
        version: '0.1.0',
        description: 'Minimal OpenAPI for TradeNext ingestion & company endpoints',
    },
    paths: {
        '/api/ingest/run': {
            post: {
                summary: 'Trigger ingestion of CSV into daily_prices',
                requestBody: {
                    content: {
                        'application/json': {
                            schema: { type: 'object', properties: { csvPath: { type: 'string' } } },
                        },
                    },
                },
                responses: {
                    '200': { description: 'Ingestion started/completed' },
                    '400': { description: 'Bad request' },
                },
            },
        },
        '/api/company/{ticker}': {
            get: {
                summary: 'Get company profile (fundamentals + recent prices)',
                parameters: [{ name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { '200': { description: 'Company object' } },
            },
        },
    },
};

export async function GET() {
    return NextResponse.json(openapi);
}
