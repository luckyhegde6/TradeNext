// app/api/openapi/route.ts
import { NextResponse } from 'next/server';

const openapi = {
    openapi: '3.0.3',
    info: {
        title: 'TradeNext API',
        version: '1.0.0',
        description: 'Comprehensive API for TradeNext - Market Intelligence Platform. Provides access to NSE market data, portfolio management, user management, and administrative functions.',
        contact: {
            name: 'TradeNext Support',
            email: 'support@tradenext.com'
        },
        license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT'
        }
    },
    servers: [
        {
            url: 'https://tradenext.com',
            description: 'Production server'
        },
        {
            url: 'http://localhost:3000',
            description: 'Development server'
        }
    ],
    security: [
        {
            bearerAuth: []
        }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            }
        },
        schemas: {
            User: {
                type: 'object',
                properties: {
                    id: { type: 'integer', example: 1 },
                    name: { type: 'string', nullable: true, example: 'John Doe' },
                    email: { type: 'string', format: 'email', example: 'john@example.com' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            StockQuote: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', example: 'SBIN' },
                    companyName: { type: 'string', example: 'State Bank of India' },
                    identifier: { type: 'string', example: 'SBINEQN' },
                    isinCode: { type: 'string', example: 'INE062A01020' },
                    series: { type: 'string', example: 'EQ' },
                    lastPrice: { type: 'number', example: 520.50 },
                    open: { type: 'number', example: 515.00 },
                    dayHigh: { type: 'number', example: 525.00 },
                    dayLow: { type: 'number', example: 510.00 },
                    previousClose: { type: 'number', example: 518.00 },
                    change: { type: 'number', example: 2.50 },
                    pChange: { type: 'number', example: 0.48 },
                    totalTradedVolume: { type: 'integer', example: 1500000 },
                    totalTradedValue: { type: 'number', example: 780000000 },
                    yearHigh: { type: 'number', example: 600.00 },
                    yearLow: { type: 'number', example: 450.00 },
                    peRatio: { type: 'number', example: 15.2 },
                    marketCap: { type: 'number', example: 4500000000000 },
                    industry: { type: 'string', example: 'Banks' },
                    sector: { type: 'string', example: 'Financial Services' },
                    indexList: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['NIFTY 50', 'NIFTY BANK']
                    }
                }
            },
            IndexQuote: {
                type: 'object',
                properties: {
                    indexName: { type: 'string', example: 'NIFTY 50' },
                    lastPrice: { type: 'string', example: '19500.50' },
                    change: { type: 'string', example: '125.30' },
                    pChange: { type: 'string', example: '0.65' },
                    open: { type: 'string', example: '19400.00' },
                    high: { type: 'string', example: '19550.00' },
                    low: { type: 'string', example: '19350.00' },
                    previousClose: { type: 'string', example: '19375.20' },
                    yearHigh: { type: 'string', example: '20000.00' },
                    yearLow: { type: 'string', example: '15000.00' },
                    peRatio: { type: 'string', example: '22.5' },
                    pbRatio: { type: 'string', example: '3.2' },
                    dividendYield: { type: 'string', example: '1.2' },
                    marketStatus: { type: 'string', example: 'Open' },
                    advances: { type: 'integer', example: 35 },
                    declines: { type: 'integer', example: 15 },
                    unchanged: { type: 'integer', example: 0 },
                    totalTradedVolume: { type: 'string', example: '250000000' },
                    totalTradedValue: { type: 'string', example: '15000000000' },
                    timestamp: { type: 'string', format: 'date-time' }
                }
            },
            PaginatedResponse: {
                type: 'object',
                properties: {
                    items: { type: 'array', items: { type: 'object' } },
                    pagination: {
                        type: 'object',
                        properties: {
                            page: { type: 'integer', example: 1 },
                            limit: { type: 'integer', example: 20 },
                            total: { type: 'integer', example: 150 },
                            totalPages: { type: 'integer', example: 8 }
                        }
                    }
                }
            },
            Error: {
                type: 'object',
                properties: {
                    error: { type: 'string', example: 'Validation failed' },
                    details: { type: 'array', items: { type: 'string' } }
                }
            }
        }
    },
    paths: {
        // Authentication
        '/api/auth/signin': {
            get: {
                summary: 'Sign in page',
                description: 'NextAuth sign-in page',
                responses: {
                    '200': { description: 'Sign-in form' }
                }
            }
        },

        // Cache Management
        '/api/cache': {
            get: {
                summary: 'Get cache statistics',
                description: 'Retrieve cache metrics and statistics',
                parameters: [
                    {
                        name: 'action',
                        in: 'query',
                        schema: { type: 'string', enum: ['metrics', 'cleanup', 'clear-hot', 'clear-static', 'clear-all'] }
                    }
                ],
                responses: {
                    '200': {
                        description: 'Cache statistics',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string' },
                                        caches: {
                                            type: 'object',
                                            properties: {
                                                main: { type: 'object', properties: { keys: { type: 'integer' } } },
                                                hot: { type: 'object', properties: { keys: { type: 'integer' } } },
                                                static: { type: 'object', properties: { keys: { type: 'integer' } } }
                                            }
                                        },
                                        queues: { type: 'object' },
                                        timestamp: { type: 'string', format: 'date-time' }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                summary: 'Perform cache operations',
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    action: { type: 'string', enum: ['cleanup', 'clear', 'clear-hot', 'clear-static'] }
                                },
                                required: ['action']
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Operation completed successfully' }
                }
            }
        },

        // User Management
        '/api/users': {
            get: {
                summary: 'Get users (paginated)',
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
                    { name: 'paginate', in: 'query', schema: { type: 'boolean', default: false } }
                ],
                responses: {
                    '200': {
                        description: 'Users list or paginated response',
                        content: {
                            'application/json': {
                                schema: {
                                    oneOf: [
                                        { $ref: '#/components/schemas/PaginatedResponse' },
                                        { type: 'object', properties: { users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },

        // Posts
        '/api/posts': {
            get: {
                summary: 'Get posts (paginated)',
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }
                ],
                responses: {
                    '200': {
                        description: 'Paginated posts',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        posts: { type: 'array', items: { type: 'object' } },
                                        totalPages: { type: 'integer' }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                summary: 'Create a new post',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    title: { type: 'string', minLength: 1 },
                                    content: { type: 'string' }
                                },
                                required: ['title']
                            }
                        }
                    }
                },
                responses: {
                    '201': { description: 'Post created' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },

        // Market Data
        '/api/nse/stock/{symbol}/quote': {
            get: {
                summary: 'Get stock quote',
                parameters: [
                    { name: 'symbol', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Z0-9.]+$' } }
                ],
                responses: {
                    '200': {
                        description: 'Stock quote data',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/StockQuote' }
                            }
                        }
                    },
                    '400': { description: 'Invalid symbol' },
                    '502': { description: 'NSE API error' }
                }
            }
        },

        '/api/nse/stock/{symbol}/chart': {
            get: {
                summary: 'Get stock chart data',
                parameters: [
                    { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'days', in: 'query', schema: { type: 'string', enum: ['1D', '1W', '1M', '3M', '6M', '1Y'], default: '1D' } }
                ],
                responses: {
                    '200': {
                        description: 'Chart data points',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'array',
                                    items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }
                                }
                            }
                        }
                    }
                }
            }
        },

        '/api/nse/index/{index}/quote': {
            get: {
                summary: 'Get index quote',
                parameters: [
                    { name: 'index', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': {
                        description: 'Index quote data',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/IndexQuote' }
                            }
                        }
                    }
                }
            }
        },

        '/api/nse/index/{index}/heatmap': {
            get: {
                summary: 'Get index constituents heatmap',
                parameters: [
                    { name: 'index', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }
                ],
                responses: {
                    '200': {
                        description: 'Paginated heatmap data',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/PaginatedResponse' }
                            }
                        }
                    }
                }
            }
        },

        // Company Data
        '/api/company/{ticker}': {
            get: {
                summary: 'Get company fundamentals and price data',
                parameters: [
                    { name: 'ticker', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Z0-9.]+$', minLength: 1, maxLength: 10 } }
                ],
                responses: {
                    '200': {
                        description: 'Company data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        ticker: { type: 'string' },
                                        prices: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    trade_date: { type: 'string', format: 'date' },
                                                    close: { type: 'number' }
                                                }
                                            }
                                        },
                                        fundamentals: { type: 'object', nullable: true }
                                    }
                                }
                            }
                        }
                    },
                    '400': { description: 'Invalid ticker format' }
                }
            }
        },

        // Portfolio
        '/api/portfolio': {
            get: {
                summary: 'Get user portfolio',
                security: [{ bearerAuth: [] }],
                responses: {
                    '200': { description: 'Portfolio data' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },

        // Announcements
        '/api/announcements': {
            get: {
                summary: 'Get corporate announcements',
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }
                ],
                responses: {
                    '200': {
                        description: 'Paginated announcements',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/PaginatedResponse' }
                            }
                        }
                    }
                }
            }
        },

        // Ingestion (Admin)
        '/api/ingest/run': {
            post: {
                summary: 'Trigger CSV data ingestion',
                description: 'Import stock price data from CSV file. Can run synchronously or asynchronously.',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    csvPath: { type: 'string', description: 'Path to CSV file (optional, uses default if not provided)' },
                                    sync: { type: 'boolean', description: 'Force synchronous processing', default: false }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Ingestion completed',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        rows: { type: 'integer', example: 1000 }
                                    }
                                }
                            }
                        }
                    },
                    '202': {
                        description: 'Ingestion queued for background processing',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'queued' },
                                        jobId: { type: 'string', example: 'ingestion:123' },
                                        message: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Invalid request',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    },
                    '401': { description: 'Unauthorized' }
                }
            }
        },

        // Job Status
        '/api/jobs/{jobId}': {
            get: {
                summary: 'Get background job status',
                description: 'Check the status and progress of background jobs like data ingestion',
                parameters: [
                    {
                        name: 'jobId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Unique job identifier returned when job was created'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Job status information',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        id: { type: 'string', example: 'ingestion:abc123' },
                                        name: { type: 'string', example: 'csv-ingestion' },
                                        data: {
                                            type: 'object',
                                            example: { csvPath: '/uploads/data.csv', sync: false }
                                        },
                                        opts: { type: 'object' },
                                        progress: { type: 'number', example: 0.75 },
                                        attemptsMade: { type: 'integer', example: 1 },
                                        finishedOn: { type: 'string', nullable: true },
                                        processedOn: { type: 'string', nullable: true },
                                        failedReason: { type: 'string', nullable: true },
                                        returnvalue: { type: 'object' },
                                        state: {
                                            type: 'string',
                                            enum: ['active', 'completed', 'failed', 'waiting'],
                                            example: 'completed'
                                        },
                                        timestamp: { type: 'string', format: 'date-time' }
                                    }
                                }
                            }
                        }
                    },
                    '404': {
                        description: 'Job not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    }
                }
            }
        },

        // Portfolio
        '/api/portfolio': {
            get: {
                summary: 'Get user portfolio',
                description: 'Retrieve the authenticated user\'s investment portfolio with holdings and performance',
                security: [{ bearerAuth: [] }],
                responses: {
                    '200': {
                        description: 'Portfolio data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        holdings: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    symbol: { type: 'string' },
                                                    quantity: { type: 'number' },
                                                    averagePrice: { type: 'number' },
                                                    currentPrice: { type: 'number' },
                                                    marketValue: { type: 'number' },
                                                    unrealizedPnL: { type: 'number' },
                                                    unrealizedPnLPercent: { type: 'number' }
                                                }
                                            }
                                        },
                                        summary: {
                                            type: 'object',
                                            properties: {
                                                totalValue: { type: 'number' },
                                                totalInvested: { type: 'number' },
                                                totalPnL: { type: 'number' },
                                                totalPnLPercent: { type: 'number' },
                                                dayChange: { type: 'number' },
                                                dayChangePercent: { type: 'number' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '401': {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    }
                }
            },
            post: {
                summary: 'Update portfolio holdings',
                description: 'Add or update holdings in the user\'s portfolio',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    holdings: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                symbol: { type: 'string' },
                                                quantity: { type: 'number' },
                                                averagePrice: { type: 'number' },
                                                transactionType: { type: 'string', enum: ['BUY', 'SELL'] },
                                                transactionDate: { type: 'string', format: 'date' }
                                            },
                                            required: ['symbol', 'quantity', 'averagePrice', 'transactionType']
                                        }
                                    }
                                },
                                required: ['holdings']
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Portfolio updated successfully' },
                    '400': {
                        description: 'Invalid request data',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    },
                    '401': { description: 'Unauthorized' }
                }
            }
        },

        // Piotroski F-Score
        '/api/piotroski/{ticker}': {
            get: {
                summary: 'Get Piotroski F-Score for a company',
                description: 'Calculate the Piotroski F-Score, a fundamental analysis metric for stock quality',
                parameters: [
                    {
                        name: 'ticker',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', pattern: '^[A-Z0-9.]+$', minLength: 1, maxLength: 10 },
                        description: 'Stock ticker symbol'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Piotroski F-Score data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        ticker: { type: 'string' },
                                        score: { type: 'integer', minimum: 0, maximum: 9 },
                                        components: {
                                            type: 'object',
                                            properties: {
                                                roa: { type: 'boolean' },
                                                operatingCashFlow: { type: 'boolean' },
                                                roaChange: { type: 'boolean' },
                                                accruals: { type: 'boolean' },
                                                leverage: { type: 'boolean' },
                                                liquidity: { type: 'boolean' },
                                                dilution: { type: 'boolean' },
                                                margin: { type: 'boolean' },
                                                turnover: { type: 'boolean' }
                                            }
                                        },
                                        grade: {
                                            type: 'string',
                                            enum: ['Poor', 'Fair', 'Good', 'Excellent'],
                                            example: 'Good'
                                        },
                                        calculatedAt: { type: 'string', format: 'date-time' }
                                    }
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Invalid ticker',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    },
                    '404': { description: 'Company data not found' }
                }
            }
        },

        // Admin Endpoints
        '/api/admin/upload': {
            post: {
                summary: 'Upload file (Admin only)',
                security: [{ bearerAuth: [] }],
                requestBody: {
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    file: { type: 'string', format: 'binary' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'File uploaded successfully' },
                    '401': { description: 'Unauthorized' }
                }
            }
        }
    }
};

export async function GET() {
    return NextResponse.json(openapi);
}
