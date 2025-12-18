// Auto-generated API client from OpenAPI spec
// Generated on: 2025-01-01

import type { User, StockQuote, IndexQuote, PaginatedResponse } from './types';

class TradeNextApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Authentication
  async signIn(credentials: { email: string; password: string }) {
    return this.request('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
  }

  // Cache Management
  async getCacheMetrics() {
    return this.request('/api/cache?action=metrics');
  }

  async cleanupCache() {
    return this.request('/api/cache?action=cleanup', { method: 'POST' });
  }

  // User Management
  async getUsers(params?: { page?: number; limit?: number; paginate?: boolean }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.paginate) searchParams.set('paginate', 'true');

    const query = searchParams.toString();
    return this.request<PaginatedResponse<User> | { users: User[] }>(
      `/api/users${query ? `?${query}` : ''}`
    );
  }

  // Posts
  async getPosts(params?: { page?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());

    const query = searchParams.toString();
    return this.request(`/api/posts${query ? `?${query}` : ''}`);
  }

  async createPost(data: { title: string; content?: string }) {
    return this.request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  // Market Data
  async getStockQuote(symbol: string): Promise<StockQuote> {
    return this.request(`/api/nse/stock/${encodeURIComponent(symbol)}/quote`);
  }

  async getStockChart(symbol: string, days: string = '1D'): Promise<unknown[]> {
    return this.request(`/api/nse/stock/${encodeURIComponent(symbol)}/chart?days=${days}`);
  }

  async getIndexQuote(indexName: string): Promise<IndexQuote> {
    return this.request(`/api/nse/index/${encodeURIComponent(indexName)}/quote`);
  }

  async getIndexHeatmap(indexName: string, params?: { page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.request(`/api/nse/index/${encodeURIComponent(indexName)}/heatmap${query ? `?${query}` : ''}`);
  }

  // Company Data
  async getCompany(ticker: string) {
    return this.request(`/api/company/${encodeURIComponent(ticker)}`);
  }

  // Portfolio
  async getPortfolio() {
    return this.request('/api/portfolio');
  }

  async updatePortfolio(data: { holdings: any[] }) {
    return this.request('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  // Announcements
  async getAnnouncements(params?: { page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.request(`/api/announcements${query ? `?${query}` : ''}`);
  }

  // Piotroski F-Score
  async getPiotroskiScore(ticker: string) {
    return this.request(`/api/piotroski/${encodeURIComponent(ticker)}`);
  }

  // Ingestion (Admin)
  async ingestData(data: { csvPath?: string; sync?: boolean }) {
    return this.request('/api/ingest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  // Job Status
  async getJobStatus(jobId: string) {
    return this.request(`/api/jobs/${jobId}`);
  }

  // Admin Operations
  async uploadFile(formData: FormData) {
    return this.request('/api/admin/upload', {
      method: 'POST',
      body: formData
    });
  }
}

export default TradeNextApiClient;
