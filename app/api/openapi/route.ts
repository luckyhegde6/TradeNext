// app/api/openapi/route.ts
import { NextResponse } from 'next/server';

const nse = (summary: string) => ({
    get: {
        summary,
        tags: ["NSE Analytics"],
        responses: {
            200: { description: "Success" },
            500: { description: "NSE fetch failure" },
        },
    },
});

const securityBearer = [{ bearerAuth: [] }];
const securityAdmin = [{ bearerAuth: [] }];

const openapi = {
    openapi: '3.0.3',
    info: {
        title: 'TradeNext API',
        version: '1.1.0',
        description: 'Comprehensive API for TradeNext - Market Intelligence Platform. Provides access to NSE market data, portfolio management, user management, and administrative functions.',
        contact: {
            name: 'TradeNext Support',
            email: 'support@tradenext.in'
        },
        license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT'
        }
    },
    servers: [
        {
            url: 'https://tradenext6.netlify.app',
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
                    role: { type: 'string', example: 'user' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            StockQuote: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', example: 'SBIN' },
                    companyName: { type: 'string', example: 'State Bank of India' },
                    identifier: { type: 'string', example: 'SBINEQN' },
                    lastPrice: { type: 'number', example: 520.50 },
                    open: { type: 'number', example: 515.00 },
                    dayHigh: { type: 'number', example: 525.00 },
                    dayLow: { type: 'number', example: 510.00 },
                    previousClose: { type: 'number', example: 518.00 },
                    change: { type: 'number', example: 2.50 },
                    pChange: { type: 'number', example: 0.48 },
                    totalTradedVolume: { type: 'integer', example: 1500000 },
                    yearHigh: { type: 'number', example: 600.00 },
                    yearLow: { type: 'number', example: 450.00 },
                    peRatio: { type: 'number', example: 15.2 },
                    marketCap: { type: 'number', example: 4500000000000 }
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
                    marketStatus: { type: 'string', example: 'Open' },
                    advances: { type: 'integer', example: 35 },
                    declines: { type: 'integer', example: 15 }
                }
            },
            Portfolio: {
                type: 'object',
                properties: {
                    id: { type: 'integer', example: 1 },
                    userId: { type: 'integer', example: 1 },
                    name: { type: 'string', example: 'My Portfolio' },
                    hasHoldings: { type: 'boolean', example: true },
                    totalValue: { type: 'number', example: 150000 },
                    totalInvested: { type: 'number', example: 100000 },
                    totalPnL: { type: 'number', example: 50000 },
                    totalPnLPercent: { type: 'number', example: 50.0 }
                }
            },
            Transaction: {
                type: 'object',
                properties: {
                    id: { type: 'integer', example: 1 },
                    ticker: { type: 'string', example: 'RELIANCE' },
                    side: { type: 'string', enum: ['BUY', 'SELL'], example: 'BUY' },
                    quantity: { type: 'integer', example: 100 },
                    price: { type: 'number', example: 2500.00 },
                    tradeDate: { type: 'string', format: 'date', example: '2024-01-15' },
                    fees: { type: 'number', nullable: true, example: 50.00 },
                    notes: { type: 'string', nullable: true, example: 'Initial purchase' }
                }
            },
            Alert: {
                type: 'object',
                properties: {
                    id: { type: 'string', example: 'uuid' },
                    type: { type: 'string', example: 'price_above' },
                    symbol: { type: 'string', example: 'RELIANCE' },
                    condition: { type: 'object', properties: { threshold: { type: 'number', example: 2500 } } },
                    triggered: { type: 'boolean', example: false },
                    seen: { type: 'boolean', example: false },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            Notification: {
                type: 'object',
                properties: {
                    id: { type: 'string', example: 'uuid' },
                    type: { type: 'string', example: 'alert_triggered' },
                    title: { type: 'string', example: 'Price Alert' },
                    message: { type: 'string', example: 'RELIANCE crossed above 2500' },
                    isRead: { type: 'boolean', example: false },
                    isAddressed: { type: 'boolean', example: false },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            Recommendation: {
                type: 'object',
                properties: {
                    id: { type: 'string', example: 'uuid' },
                    symbol: { type: 'string', example: 'RELIANCE' },
                    recommendation: { type: 'string', enum: ['BUY', 'SELL', 'HOLD', 'ACCUMULATE', 'NEUTRAL'], example: 'BUY' },
                    targetPrice: { type: 'number', example: 2800 },
                    profitRangeMin: { type: 'number', example: 2600 },
                    profitRangeMax: { type: 'number', example: 3000 },
                    analystRating: { type: 'string', example: 'Strong Buy' },
                    isActive: { type: 'boolean', example: true },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            Watchlist: {
                type: 'object',
                properties: {
                    id: { type: 'integer', example: 1 },
                    name: { type: 'string', example: 'My Watchlist' },
                    symbols: { type: 'array', items: { type: 'string' }, example: ['RELIANCE', 'TCS', 'INFY'] },
                    createdAt: { type: 'string', format: 'date-time' }
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
        // ==================== AUTHENTICATION ====================
        '/api/auth/signin': {
            get: {
                summary: 'Sign in page',
                description: 'NextAuth sign-in page',
                tags: ['Authentication'],
                responses: { '200': { description: 'Sign-in form' } }
            }
        },
        '/api/auth/signout': {
            post: {
                summary: 'Sign out',
                description: 'Sign out the current user',
                tags: ['Authentication'],
                security: securityBearer,
                responses: {
                    '302': { description: 'Redirect to home' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },

        // ==================== USER MANAGEMENT ====================
        '/api/users': {
            get: {
                summary: 'Get users (paginated)',
                tags: ['Users'],
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
                ],
                responses: {
                    '200': { description: 'Users list' },
                    '401': { description: 'Unauthorized' }
                }
            },
            post: {
                summary: 'Register new user',
                tags: ['Users'],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    email: { type: 'string', format: 'email' },
                                    password: { type: 'string', minLength: 6 }
                                },
                                required: ['email', 'password']
                            }
                        }
                    }
                },
                responses: {
                    '201': { description: 'User created' },
                    '400': { description: 'Invalid input' }
                }
            }
        },
        '/api/users/profile': {
            get: {
                summary: 'Get current user profile',
                tags: ['Users'],
                security: securityBearer,
                responses: { '200': { description: 'User profile' } }
            },
            put: {
                summary: 'Update user profile',
                tags: ['Users'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    mobile: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Profile updated' } }
            }
        },
        '/api/users/signup': {
            post: {
                summary: 'User registration',
                tags: ['Users'],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    email: { type: 'string', format: 'email' },
                                    password: { type: 'string', minLength: 6 }
                                },
                                required: ['email', 'password']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'User registered' } }
            }
        },

        // ==================== PORTFOLIO ====================
        '/api/portfolio': {
            get: {
                summary: 'Get user portfolio',
                tags: ['Portfolio'],
                security: securityBearer,
                parameters: [
                    { name: 'userId', in: 'query', schema: { type: 'integer' }, description: 'Admin only' }
                ],
                responses: { '200': { description: 'Portfolio data' } }
            },
            post: {
                summary: 'Update portfolio holdings',
                tags: ['Portfolio'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    holdings: { type: 'array', items: { type: 'object' } }
                                }
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Portfolio updated' } }
            }
        },
        '/api/portfolio/create': {
            post: {
                summary: 'Initialize user portfolio',
                tags: ['Portfolio'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    userId: { type: 'integer' }
                                },
                                required: ['name']
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Portfolio created' } }
            }
        },
        '/api/portfolio/{id}': {
            get: {
                summary: 'Get portfolio by ID',
                tags: ['Portfolio'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'Portfolio data' } }
            },
            delete: {
                summary: 'Delete portfolio',
                tags: ['Portfolio'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'Portfolio deleted' } }
            }
        },
        '/api/portfolio/transactions': {
            get: {
                summary: 'Get portfolio transactions',
                tags: ['Portfolio'],
                security: securityBearer,
                responses: { '200': { description: 'Transactions list' } }
            },
            post: {
                summary: 'Add transaction',
                tags: ['Portfolio'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    ticker: { type: 'string' },
                                    side: { type: 'string', enum: ['BUY', 'SELL'] },
                                    quantity: { type: 'integer' },
                                    price: { type: 'number' },
                                    tradeDate: { type: 'string', format: 'date' },
                                    fees: { type: 'number' },
                                    notes: { type: 'string' }
                                },
                                required: ['ticker', 'side', 'quantity', 'price']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Transaction added' } }
            }
        },
        '/api/portfolio/funds': {
            get: {
                summary: 'Get fund transactions',
                tags: ['Portfolio'],
                security: securityBearer,
                responses: { '200': { description: 'Fund transactions' } }
            },
            post: {
                summary: 'Add fund transaction',
                tags: ['Portfolio'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['DEPOSIT', 'WITHDRAWAL'] },
                                    amount: { type: 'number' },
                                    date: { type: 'string', format: 'date' },
                                    notes: { type: 'string' }
                                },
                                required: ['type', 'amount']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Fund transaction added' } }
            }
        },
        '/api/portfolio/import': {
            post: {
                summary: 'Import transactions from CSV',
                tags: ['Portfolio'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    csvData: { type: 'string' }
                                },
                                required: ['csvData']
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Transactions imported' } }
            }
        },

        // ==================== USER HOLDINGS (NEW) ====================
        '/api/user/holdings': {
            get: {
                summary: 'Get user transactions',
                tags: ['User Holdings'],
                security: securityBearer,
                responses: { '200': { description: 'Transactions list' } }
            },
            post: {
                summary: 'Add transaction',
                tags: ['User Holdings'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    ticker: { type: 'string' },
                                    side: { type: 'string', enum: ['BUY', 'SELL'] },
                                    quantity: { type: 'integer' },
                                    price: { type: 'number' },
                                    tradeDate: { type: 'string', format: 'date' },
                                    fees: { type: 'number' },
                                    notes: { type: 'string' }
                                },
                                required: ['ticker', 'side', 'quantity', 'price']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Transaction added' } }
            },
            delete: {
                summary: 'Delete transaction',
                tags: ['User Holdings'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Transaction deleted' } }
            }
        },

        // ==================== ALERTS ====================
        '/api/alerts': {
            get: {
                summary: 'Get user alerts',
                tags: ['Alerts'],
                security: securityBearer,
                responses: { '200': { description: 'Alerts list' } }
            },
            post: {
                summary: 'Create alert',
                tags: ['Alerts'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['price_above', 'price_below', 'volume_spike', 'price_jump'] },
                                    symbol: { type: 'string' },
                                    condition: { type: 'object' }
                                },
                                required: ['type', 'condition']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Alert created' } }
            },
            put: {
                summary: 'Update alert',
                tags: ['Alerts'],
                security: securityBearer,
                parameters: [
                    { name: 'action', in: 'query', schema: { type: 'string', enum: ['update', 'markSeen', 'delete'] } },
                    { name: 'id', in: 'query', schema: { type: 'string' } }
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string' },
                                    symbol: { type: 'string' },
                                    condition: { type: 'object' }
                                }
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Alert updated' } }
            },
            delete: {
                summary: 'Delete alert',
                tags: ['Alerts'],
                security: securityBearer,
                parameters: [
                    { name: 'action', in: 'query', schema: { type: 'string', enum: ['delete'] } },
                    { name: 'id', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Alert deleted' } }
            }
        },
        '/api/user/alerts': {
            get: {
                summary: 'Get user alerts (new model)',
                tags: ['Alerts'],
                security: securityBearer,
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string' } },
                    { name: 'today', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Alerts list' } }
            },
            post: {
                summary: 'Create alert',
                tags: ['Alerts'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    symbol: { type: 'string' },
                                    alertType: { type: 'string', enum: ['price_above', 'price_below', 'volume_spike', 'custom'] },
                                    title: { type: 'string' },
                                    message: { type: 'string' },
                                    targetPrice: { type: 'number' }
                                },
                                required: ['alertType', 'title']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Alert created' } }
            },
            put: {
                summary: 'Update alert',
                tags: ['Alerts'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    status: { type: 'string' },
                                    currentPrice: { type: 'number' }
                                }
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Alert updated' } }
            },
            delete: {
                summary: 'Delete alert',
                tags: ['Alerts'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Alert deleted' } }
            }
        },

        // ==================== NOTIFICATIONS ====================
        '/api/notifications': {
            get: {
                summary: 'Get user notifications',
                tags: ['Notifications'],
                security: securityBearer,
                responses: { '200': { description: 'Notifications list' } }
            }
        },
        '/api/notifications/read-all': {
            post: {
                summary: 'Mark all notifications as read',
                tags: ['Notifications'],
                security: securityBearer,
                responses: { '200': { description: 'Notifications marked as read' } }
            }
        },
        '/api/user/notifications': {
            get: {
                summary: 'Get user notifications',
                tags: ['Notifications'],
                security: securityBearer,
                responses: { '200': { description: 'Notifications list' } }
            }
        },
        '/api/admin/notifications': {
            get: {
                summary: 'Get admin notifications',
                tags: ['Admin - Notifications'],
                security: securityAdmin,
                parameters: [
                    { name: 'addressed', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Notifications list' } }
            },
            put: {
                summary: 'Update notification (mark read/address)',
                tags: ['Admin - Notifications'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    action: { type: 'string', enum: ['markRead', 'address', 'markAllRead'] },
                                    response: { type: 'string' }
                                },
                                required: ['id', 'action']
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Notification updated' } }
            },
            delete: {
                summary: 'Delete notification',
                tags: ['Admin - Notifications'],
                security: securityAdmin,
                parameters: [
                    { name: 'id', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Notification deleted' } }
            }
        },

        // ==================== WATCHLIST ====================
        '/api/user/watchlist': {
            get: {
                summary: 'Get user watchlists',
                tags: ['Watchlist'],
                security: securityBearer,
                responses: { '200': { description: 'Watchlists' } }
            },
            post: {
                summary: 'Create watchlist',
                tags: ['Watchlist'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    symbols: { type: 'array', items: { type: 'string' } }
                                },
                                required: ['name']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Watchlist created' } }
            }
        },
        '/api/user/watchlist/{id}': {
            get: {
                summary: 'Get watchlist by ID',
                tags: ['Watchlist'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'Watchlist data' } }
            },
            put: {
                summary: 'Update watchlist',
                tags: ['Watchlist'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    symbols: { type: 'array', items: { type: 'string' } }
                                }
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Watchlist updated' } }
            },
            delete: {
                summary: 'Delete watchlist',
                tags: ['Watchlist'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'Watchlist deleted' } }
            }
        },

        // ==================== RECOMMENDATIONS ====================
        '/api/user/recommendations': {
            get: {
                summary: 'Get user recommendations',
                tags: ['Recommendations'],
                security: securityBearer,
                responses: { '200': { description: 'Recommendations list' } }
            },
            post: {
                summary: 'Subscribe to recommendation',
                tags: ['Recommendations'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    recommendationId: { type: 'string' }
                                },
                                required: ['recommendationId']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Subscribed' } }
            },
            delete: {
                summary: 'Unsubscribe from recommendation',
                tags: ['Recommendations'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'query', schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Unsubscribed' } }
            }
        },
        '/api/user/subscriptions': {
            get: {
                summary: 'Get user subscriptions',
                tags: ['Recommendations'],
                security: securityBearer,
                responses: { '200': { description: 'Subscriptions list' } }
            }
        },

        // ==================== MARKET DATA ====================
        '/api/nse/stock/{symbol}/quote': {
            get: {
                summary: 'Get stock quote',
                tags: ['Market Data'],
                parameters: [
                    { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Stock quote' } }
            }
        },
        '/api/nse/stock/{symbol}/chart': {
            get: {
                summary: 'Get stock chart data',
                tags: ['Market Data'],
                parameters: [
                    { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'days', in: 'query', schema: { type: 'string', enum: ['1D', '1W', '1M', '3M', '6M', '1Y'], default: '1D' } }
                ],
                responses: { '200': { description: 'Chart data' } }
            }
        },
        '/api/nse/stock/{symbol}/corporate': {
            get: {
                summary: 'Get stock corporate data',
                tags: ['Market Data'],
                parameters: [
                    { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'type', in: 'query', schema: { type: 'string', enum: ['all', 'financials', 'events', 'announcements', 'actions'], default: 'all' } }
                ],
                responses: { '200': { description: 'Corporate data' } }
            }
        },
        '/api/nse/stock/{symbol}/trends': {
            get: {
                summary: 'Get stock trends',
                tags: ['Market Data'],
                parameters: [
                    { name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Trends data' } }
            }
        },
        '/api/nse/index/{index}/quote': nse('Get index quote'),
        '/api/nse/indexes': nse('Get all indices'),
        '/api/nse/index/{index}/chart': nse('Get index chart'),
        '/api/nse/index/{index}/heatmap': nse('Get index constituents heatmap'),
        '/api/nse/index/{index}/symbols': nse('Get index constituents'),
        '/api/nse/index/{index}/announcements': nse('Get index announcements'),
        '/api/nse/index/{index}/corp-actions': nse('Get index corporate actions'),
        '/api/nse/index/{index}/advance-decline': nse('Get index advance/decline'),
        '/api/nse/advance-decline': nse('Get advance/decline analysis'),
         '/api/nse/corporate-announcements': nse('Get corporate announcements'),
         '/api/nse/corporate-events': nse('Get corporate events'),
         '/api/nse/corporate-info': nse('Get corporate info'),
        '/api/nse/corporate-news': nse('Get corporate news'),
        '/api/nse/insider-trading': nse('Get insider trading'),
        '/api/nse/deals': nse('Get deals'),
        '/api/nse/gainers': nse('Get gainers'),
        '/api/nse/losers': nse('Get losers'),
        '/api/nse/most-active': nse('Get most active'),
        '/api/nse/marquee': nse('Get marquee data'),

        // ==================== COMPANY DATA ====================
        '/api/company/{ticker}': {
            get: {
                summary: 'Get company fundamentals and price data',
                tags: ['Company'],
                parameters: [
                    { name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Company data' } }
            }
        },
        '/api/company/{ticker}/fscore': {
            get: {
                summary: 'Get Piotroski F-Score',
                tags: ['Company'],
                parameters: [
                    { name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'F-Score data' } }
            }
        },

        // ==================== ANALYTICS ====================
        '/api/analytics/market': {
            get: {
                summary: 'Get market analytics',
                tags: ['Analytics'],
                responses: { '200': { description: 'Market analytics' } }
            }
        },
        '/api/analytics/stock/{ticker}': {
            get: {
                summary: 'Get stock analytics',
                tags: ['Analytics'],
                parameters: [
                    { name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Stock analytics' } }
            }
        },
        '/api/analytics/portfolio/{id}': {
            get: {
                summary: 'Get portfolio analytics',
                tags: ['Analytics'],
                security: securityBearer,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'Portfolio analytics' } }
            }
        },

        // ==================== SCREENER ====================
        '/api/screener': {
            get: {
                summary: 'Get stock screener',
                tags: ['Screener'],
                responses: { '200': { description: 'Screener results' } }
            }
        },
        '/api/screener/saved': {
            get: {
                summary: 'Get saved screeners',
                tags: ['Screener'],
                security: securityBearer,
                responses: { '200': { description: 'Saved screeners' } }
            },
            post: {
                summary: 'Save screener',
                tags: ['Screener'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    filters: { type: 'object' }
                                },
                                required: ['name', 'filters']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Screener saved' } }
            }
        },

        // ==================== NEWS ====================
        '/api/news/market': {
            get: {
                summary: 'Get market news',
                tags: ['News'],
                parameters: [
                    { name: 'type', in: 'query', schema: { type: 'string', enum: ['all', 'india', 'global'], default: 'all' } },
                    { name: 'force', in: 'query', schema: { type: 'boolean', default: false } }
                ],
                responses: { '200': { description: 'Market news' } }
            }
        },
        '/api/announcements': {
            get: {
                summary: 'Get corporate announcements',
                tags: ['Announcements'],
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
                ],
                responses: { '200': { description: 'Announcements' } }
            }
        },

        // ==================== COMPARISON ====================
        '/api/compare': {
            get: {
                summary: 'Compare stocks',
                tags: ['Comparison'],
                parameters: [
                    { name: 'symbols', in: 'query', schema: { type: 'string' }, description: 'Comma-separated symbols' }
                ],
                responses: { '200': { description: 'Comparison data' } }
            }
        },

        // ==================== QUOTE ====================
        '/api/quote': {
            get: {
                summary: 'Get quotes for multiple symbols',
                tags: ['Quote'],
                parameters: [
                    { name: 'symbols', in: 'query', schema: { type: 'string' }, description: 'Comma-separated symbols' }
                ],
                responses: { '200': { description: 'Quotes' } }
            }
        },

        // ==================== SYMBOLS ====================
        '/api/symbols/search': {
            get: {
                summary: 'Search symbols',
                tags: ['Symbols'],
                parameters: [
                    { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' }
                ],
                responses: { '200': { description: 'Search results' } }
            }
        },

        // ==================== POSTS ====================
        '/api/posts': {
            get: {
                summary: 'Get posts',
                tags: ['Posts'],
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }
                ],
                responses: { '200': { description: 'Posts list' } }
            },
            post: {
                summary: 'Create post',
                tags: ['Posts'],
                security: securityBearer,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                    content: { type: 'string' }
                                },
                                required: ['title']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Post created' } }
            }
        },
        '/api/home/recent-posts': {
            get: {
                summary: 'Get recent posts for home page',
                tags: ['Posts'],
                responses: { '200': { description: 'Recent posts' } }
            }
        },

        // ==================== CACHE ====================
        '/api/cache': {
            get: {
                summary: 'Get cache statistics',
                tags: ['System'],
                parameters: [
                    { name: 'action', in: 'query', schema: { type: 'string', enum: ['metrics', 'cleanup', 'clear-hot', 'clear-static', 'clear-all'] } }
                ],
                responses: { '200': { description: 'Cache stats' } }
            },
            post: {
                summary: 'Perform cache operations',
                tags: ['System'],
                security: securityAdmin,
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
                responses: { '200': { description: 'Operation completed' } }
            }
        },

        // ==================== RATE LIMIT ====================
        '/api/rate-limit': {
            get: {
                summary: 'Get rate limit status',
                tags: ['System'],
                responses: { '200': { description: 'Rate limit info' } }
            }
        },

        // ==================== JOBS ====================
        '/api/jobs/{jobId}': {
            get: {
                summary: 'Get background job status',
                tags: ['Jobs'],
                parameters: [
                    { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '200': { description: 'Job status' }, '404': { description: 'Job not found' } }
            }
        },

        // ==================== INGESTION ====================
        '/api/ingest/run': {
            post: {
                summary: 'Trigger CSV data ingestion',
                tags: ['Admin - Ingestion'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    csvPath: { type: 'string' },
                                    sync: { type: 'boolean', default: false }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Completed' },
                    '202': { description: 'Queued' }
                }
            }
        },
        '/api/ingest/from-zip': {
            post: {
                summary: 'Ingest data from ZIP file',
                tags: ['Admin - Ingestion'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    url: { type: 'string' }
                                },
                                required: ['url']
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Ingestion started' } }
            }
        },

        // ==================== ADMIN - USERS ====================
        '/api/admin/users': {
            get: {
                summary: 'Get all users (admin)',
                tags: ['Admin - Users'],
                security: securityAdmin,
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
                ],
                responses: { '200': { description: 'Users list' } }
            }
        },
        '/api/admin/users/{id}': {
            get: {
                summary: 'Get user by ID (admin)',
                tags: ['Admin - Users'],
                security: securityAdmin,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'User data' } }
            },
            put: {
                summary: 'Update user (admin)',
                tags: ['Admin - Users'],
                security: securityAdmin,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    role: { type: 'string', enum: ['user', 'admin'] },
                                    email: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                responses: { '200': { description: 'User updated' } }
            },
            delete: {
                summary: 'Delete user (admin)',
                tags: ['Admin - Users'],
                security: securityAdmin,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'User deleted' } }
            }
        },
        '/api/admin/users/{id}/portfolio': {
            get: {
                summary: 'Get user portfolio (admin)',
                tags: ['Admin - Users'],
                security: securityAdmin,
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
                ],
                responses: { '200': { description: 'User portfolio' } }
            }
        },
        '/api/admin/active-users': {
            get: {
                summary: 'Get active users statistics',
                tags: ['Admin - Users'],
                security: securityAdmin,
                responses: { '200': { description: 'Active users data' } }
            }
        },

        // ==================== ADMIN - STATS ====================
        '/api/admin/stats': {
            get: {
                summary: 'Get admin statistics',
                tags: ['Admin - Stats'],
                security: securityAdmin,
                responses: { '200': { description: 'System stats' } }
            }
        },
        '/api/admin/nse-stats': {
            get: {
                summary: 'Get NSE API usage statistics',
                tags: ['Admin - Stats'],
                security: securityAdmin,
                parameters: [
                    { name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }
                ],
                responses: { '200': { description: 'NSE stats' } }
            }
        },

        // ==================== ADMIN - ALERTS ====================
        '/api/admin/alerts': {
            get: {
                summary: 'Get all alerts (admin)',
                tags: ['Admin - Alerts'],
                security: securityAdmin,
                responses: { '200': { description: 'All alerts' } }
            }
        },

        // ==================== ADMIN - HOLDINGS ====================
        '/api/admin/holdings': {
            get: {
                summary: 'Get all user holdings (admin)',
                tags: ['Admin - Holdings'],
                security: securityAdmin,
                responses: { '200': { description: 'All holdings' } }
            },
            post: {
                summary: 'Add transaction for user (admin)',
                tags: ['Admin - Holdings'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    userId: { type: 'integer' },
                                    ticker: { type: 'string' },
                                    side: { type: 'string', enum: ['BUY', 'SELL'] },
                                    quantity: { type: 'integer' },
                                    price: { type: 'number' },
                                    tradeDate: { type: 'string', format: 'date' }
                                },
                                required: ['userId', 'ticker', 'side', 'quantity', 'price']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Transaction added' } }
            }
        },

        // ==================== ADMIN - RECOMMENDATIONS ====================
        '/api/admin/recommendations': {
            get: {
                summary: 'Get all recommendations (admin)',
                tags: ['Admin - Recommendations'],
                security: securityAdmin,
                responses: { '200': { description: 'All recommendations' } }
            },
            post: {
                summary: 'Create recommendation (admin)',
                tags: ['Admin - Recommendations'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    symbol: { type: 'string' },
                                    recommendation: { type: 'string', enum: ['BUY', 'SELL', 'HOLD', 'ACCUMULATE', 'NEUTRAL'] },
                                    entryRange: { type: 'string' },
                                    shortTerm: { type: 'string' },
                                    longTerm: { type: 'string' },
                                    intraday: { type: 'string' },
                                    targetPrice: { type: 'number' },
                                    profitRangeMin: { type: 'number' },
                                    profitRangeMax: { type: 'number' },
                                    analystRating: { type: 'string' },
                                    analysis: { type: 'string' },
                                    isActive: { type: 'boolean', default: true }
                                },
                                required: ['symbol', 'recommendation']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Recommendation created' } }
            }
        },

        // ==================== ADMIN - AUDIT ====================
        '/api/admin/audit': {
            get: {
                summary: 'Get audit logs (admin)',
                tags: ['Admin - Audit'],
                security: securityAdmin,
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'action', in: 'query', schema: { type: 'string' } },
                    { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
                    { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } }
                ],
                responses: { '200': { description: 'Audit logs' } }
            }
        },

        // ==================== ADMIN - SYMBOLS ====================
        '/api/admin/symbols': {
            get: {
                summary: 'Get all symbols (admin)',
                tags: ['Admin - Symbols'],
                security: securityAdmin,
                responses: { '200': { description: 'All symbols' } }
            },
            post: {
                summary: 'Add symbol (admin)',
                tags: ['Admin - Symbols'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    symbol: { type: 'string' },
                                    companyName: { type: 'string' },
                                    series: { type: 'string' },
                                    industry: { type: 'string' }
                                },
                                required: ['symbol', 'companyName']
                            }
                        }
                    }
                },
                responses: { '201': { description: 'Symbol created' } }
            }
        },

        // ==================== ADMIN - UPLOAD ====================
        '/api/admin/upload': {
            post: {
                summary: 'Upload file (admin)',
                tags: ['Admin - Upload'],
                security: securityAdmin,
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
                responses: { '200': { description: 'File uploaded' } }
            }
        },

        // ==================== ADMIN - NSE SYNC ====================
        '/api/admin/nse/sync': {
            post: {
                summary: 'Sync NSE data (admin)',
                tags: ['Admin - NSE'],
                security: securityAdmin,
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['symbols', 'quotes', 'indices'] }
                                },
                                required: ['type']
                            }
                        }
                    }
                },
                responses: { '200': { description: 'Sync started' } }
            }
        },

        // ==================== ADMIN - INGEST ANNOUNCEMENTS ====================
        '/api/admin/ingest/announcements': {
            post: {
                summary: 'Ingest announcements (admin)',
                tags: ['Admin - Ingestion'],
                security: securityAdmin,
                responses: { '200': { description: 'Ingest started' } }
            }
        }
    }
};

export async function GET() {
    return NextResponse.json(openapi);
}
