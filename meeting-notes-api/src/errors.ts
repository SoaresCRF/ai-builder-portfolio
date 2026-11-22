export class UpstreamError extends Error {
  readonly errorName?: string;
  readonly status?: number;

  constructor(message: string, diagnostics: { errorName?: string; status?: number } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.errorName = diagnostics.errorName;
    this.status = diagnostics.status;
  }
}

export class RateLimitedError extends Error {
  constructor(message = "Model rate limit reached") {
    super(message);
    this.name = "RateLimitedError";
  }
}
