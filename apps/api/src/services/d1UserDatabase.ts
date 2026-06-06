/**
 * D1 User Database Service
 * All user data stored in Cloudflare D1 via Worker API
 */

const WORKER_URL = process.env.TRACKING_WORKER_URL || '';

import { logger } from '../utils/logger';

export interface D1User {
  id: string;
  email: string;
  name: string;
}

export interface D1Session {
  token: string;
  user: D1User;
  expiresAt: string;
}

export interface D1SMTPConfig {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  from_email: string;
  from_name: string;
  provider_type: 'smtp' | 'google' | 'microsoft' | 'ses' | 'mailgun' | 'sendgrid';
  api_key?: string;
  api_secret?: string;
  api_region?: string;
  api_domain?: string;
  oauth_email?: string;
  oauth_access_token?: string;
  oauth_refresh_token?: string;
  oauth_expires_at?: string;
  is_default: boolean;
  created_at: string;
}

class D1UserDatabase {
  private workerUrl: string;
  // Local cache for session validation (reduces API calls)
  private sessionCache: Map<string, { user: D1User; expiresAt: number }> = new Map();

  constructor() {
    this.workerUrl = WORKER_URL;
  }

  isConfigured(): boolean {
    return !!this.workerUrl;
  }

  // ============================================================================
  // AUTH METHODS
  // ============================================================================

  async register(email: string, password: string, name?: string): Promise<D1Session | null> {
    try {
      const response = await fetch(`${this.workerUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });

      const data = await response.json() as any;
      if (!data.success) {
        logger.error('Registration failed:', data.error);
        return null;
      }

      // Cache the session
      this.sessionCache.set(data.token, {
        user: data.user,
        expiresAt: new Date(data.expiresAt).getTime()
      });

      return { token: data.token, user: data.user, expiresAt: data.expiresAt };
    } catch (error) {
      logger.error('Registration error:', error);
      return null;
    }
  }

  async login(email: string, password: string): Promise<D1Session | null> {
    try {
      const response = await fetch(`${this.workerUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json() as any;
      if (!data.success) {
        logger.error('Login failed:', data.error);
        return null;
      }

      // Cache the session
      this.sessionCache.set(data.token, {
        user: data.user,
        expiresAt: new Date(data.expiresAt).getTime()
      });

      return { token: data.token, user: data.user, expiresAt: data.expiresAt };
    } catch (error) {
      logger.error('Login error:', error);
      return null;
    }
  }

  async logout(token: string): Promise<boolean> {
    try {
      this.sessionCache.delete(token);
      
      await fetch(`${this.workerUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      return true;
    } catch (error) {
      logger.error('Logout error:', error);
      return false;
    }
  }

  async validateSession(token: string): Promise<D1User | null> {
    // Check local cache first
    const cached = this.sessionCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    // Validate with Worker
    try {
      const response = await fetch(`${this.workerUrl}/api/auth/validate`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json() as any;
      if (!data.success) {
        this.sessionCache.delete(token);
        return null;
      }

      // Update cache
      this.sessionCache.set(token, {
        user: data.user,
        expiresAt: Date.now() + 5 * 60 * 1000 // Cache for 5 minutes
      });

      return data.user;
    } catch (error) {
      logger.error('Session validation error:', error);
      return null;
    }
  }

  // ============================================================================
  // SMTP CONFIG METHODS
  // ============================================================================

  async getUserSMTPConfigs(userId: string): Promise<D1SMTPConfig[]> {
    try {
      const response = await fetch(`${this.workerUrl}/api/configs?user_id=${userId}`);
      const data = await response.json() as any;
      
      if (!data.success) return [];
      
      return data.configs.map((c: any) => ({
        ...c,
        secure: !!c.secure,
        is_default: !!c.is_default
      }));
    } catch (error) {
      logger.error('Get configs error:', error);
      return [];
    }
  }

  async getUserDefaultSMTPConfig(userId: string): Promise<D1SMTPConfig | null> {
    const configs = await this.getUserSMTPConfigs(userId);
    return configs.find(c => c.is_default) || configs[0] || null;
  }

  async createSMTPConfig(config: Partial<D1SMTPConfig> & { user_id: string; name: string }): Promise<string | null> {
    try {
      const response = await fetch(`${this.workerUrl}/api/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const data = await response.json() as any;
      return data.success ? data.id : null;
    } catch (error) {
      logger.error('Create config error:', error);
      return null;
    }
  }

  async updateSMTPConfig(configId: string, userId: string, updates: Partial<D1SMTPConfig>): Promise<boolean> {
    try {
      const response = await fetch(`${this.workerUrl}/api/configs/${configId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, user_id: userId })
      });

      const data = await response.json() as any;
      return data.success;
    } catch (error) {
      logger.error('Update config error:', error);
      return false;
    }
  }

  async deleteSMTPConfig(configId: string, userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.workerUrl}/api/configs/${configId}?user_id=${userId}`, {
        method: 'DELETE'
      });

      const data = await response.json() as any;
      return data.success;
    } catch (error) {
      logger.error('Delete config error:', error);
      return false;
    }
  }

  async updateOAuthTokens(configId: string, userId: string, accessToken: string, expiresAt: string): Promise<boolean> {
    return this.updateSMTPConfig(configId, userId, {
      oauth_access_token: accessToken,
      oauth_expires_at: expiresAt
    });
  }

  needsTokenRefresh(config: D1SMTPConfig): boolean {
    if (!config.oauth_expires_at) return true;
    const expiresAt = new Date(config.oauth_expires_at).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    return expiresAt - now < fiveMinutes;
  }
}

export const d1UserDatabase = new D1UserDatabase();
