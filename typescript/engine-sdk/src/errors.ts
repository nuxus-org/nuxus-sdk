export class EngineError extends Error {
  constructor(
    readonly code: string | number,
    message: string,
    readonly retryable = true,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
