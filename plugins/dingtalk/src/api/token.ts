const TOKEN_ENDPOINT = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const DEFAULT_EXPIRE_IN_SECONDS = 7200;
/** Refresh this many seconds before the documented expiry to absorb clock skew. */
const REFRESH_MARGIN_SECONDS = 300;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type TokenResponse = {
  accessToken?: string;
  expireIn?: number;
};

/**
 * In-memory access token manager for one DingTalk app.
 *
 * Tokens are cached for their documented validity window (7200s, refreshed
 * slightly early) and are never persisted to disk or written to logs.
 */
export class AccessTokenManager {
  private token?: string;
  private expiresAt = 0;
  private fetching?: Promise<string>;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    // Coalesce concurrent refreshes into a single request.
    if (!this.fetching) {
      this.fetching = this.requestToken().finally(() => {
        this.fetching = undefined;
      });
    }
    return this.fetching;
  }

  clear(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async requestToken(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appKey: this.clientId, appSecret: this.clientSecret }),
      });
    } catch (err) {
      throw new Error(
        `DingTalk accessToken request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new Error(`DingTalk accessToken request failed with HTTP ${response.status}`);
    }
    const data = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!data.accessToken) {
      throw new Error("DingTalk accessToken response is missing the accessToken field");
    }
    const expireInSeconds =
      typeof data.expireIn === "number" && data.expireIn > 0
        ? data.expireIn
        : DEFAULT_EXPIRE_IN_SECONDS;
    this.token = data.accessToken;
    this.expiresAt = Date.now() + Math.max(0, expireInSeconds - REFRESH_MARGIN_SECONDS) * 1000;
    return this.token;
  }
}
