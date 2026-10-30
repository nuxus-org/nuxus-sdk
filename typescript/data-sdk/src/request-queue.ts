import { DataError } from './types.js';
import {
  cancelled,
  invalidResponse,
  record,
  responseResult,
} from './protocol.js';

export interface QueueOptions<T> {
  signal?: AbortSignal;
  onResult?: (value: T) => void;
  isRelevant?: () => boolean;
  resource?: boolean;
  authentication?: boolean;
}
interface Job {
  id: string;
  method: string;
  params?: object;
  sent: boolean;
  parse: (value: unknown) => unknown;
  accept?: (value: unknown) => void;
  resolve: (value: unknown) => void;
  reject: (error: DataError) => void;
  timer: ReturnType<typeof setTimeout>;
  detach?: () => void;
  relevant?: () => boolean;
  resource: boolean;
  authentication: boolean;
}

/** One queue per socket. Every batch entry consumes a local rate-budget unit. */
export class RequestQueue {
  private readonly jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private sentTimes: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private counter = 0;
  private inFlight = 0;
  private closed = false;

  constructor(
    private readonly send: (text: string) => void,
    private readonly timeoutMs: number,
    private readonly perSecond: number,
    private readonly onFatal: (error: DataError) => void,
  ) {}

  request<T>(
    method: string,
    params: object | undefined,
    parse: (value: unknown) => T,
    options: QueueOptions<T> = {},
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(
        new DataError('disconnected', 'Data connection lost.', true),
      );
    if (options.signal?.aborted || options.isRelevant?.() === false)
      return Promise.reject(cancelled());
    if (this.jobs.size >= 256)
      return Promise.reject(
        new DataError('request_limit', 'Too many queued data requests.'),
      );
    return new Promise<T>((resolve, reject) => {
      const id = `data-${++this.counter}`;
      const job: Job = {
        id,
        method,
        params,
        parse,
        sent: false,
        accept: options.onResult as ((value: unknown) => void) | undefined,
        resolve: resolve as (value: unknown) => void,
        reject,
        relevant: options.isRelevant,
        resource: options.resource ?? false,
        authentication: options.authentication ?? false,
        timer: setTimeout(() => {
          this.finish(job);
          const error = new DataError(
            'request_timeout',
            'Data request timed out.',
            true,
          );
          reject(error);
          // Closing the connection clears a potentially created-but-unacknowledged subscription.
          if (job.sent && job.resource) this.onFatal(error);
        }, this.timeoutMs),
      };
      this.jobs.set(id, job);
      const abort = (): void => {
        this.finish(job);
        reject(cancelled());
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      job.detach = (): void =>
        options.signal?.removeEventListener('abort', abort);
      if (options.authentication) this.transmit([job]);
      else {
        this.queue.push(job);
        this.schedule();
      }
    });
  }

  receive(message: unknown): void {
    if (!record(message) || typeof message.id !== 'string') return;
    const job = this.jobs.get(message.id);
    if (!job) return; // Cancelled read or an old response.
    if (!job.sent) {
      this.onFatal(invalidResponse());
      return;
    }
    this.finish(job);
    try {
      const value = job.parse(
        responseResult(message, job.id, job.authentication),
      );
      // Run before resolving the Promise so an immediate notification sees its ID.
      job.accept?.(value);
      job.resolve(value);
    } catch (error) {
      const failure = error instanceof DataError ? error : invalidResponse();
      job.reject(failure);
      if (failure.code === 'invalid_response') this.onFatal(failure);
    }
  }

  close(error: DataError): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.detach?.();
      job.reject(error);
    }
    this.jobs.clear();
    this.queue = [];
    this.inFlight = 0;
  }

  private finish(job: Job): void {
    if (!this.jobs.delete(job.id)) return;
    clearTimeout(job.timer);
    job.detach?.();
    if (job.sent) this.inFlight--;
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || this.timer || !this.queue.length || this.inFlight >= 32)
      return;
    const now = Date.now();
    this.sentTimes = this.sentTimes.filter((time) => now - time < 1000);
    const wait =
      this.sentTimes.length < this.perSecond
        ? 0
        : Math.max(1, this.sentTimes[0]! + 1001 - now);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  private flush(): void {
    if (this.closed) return;
    this.sentTimes = this.sentTimes.filter((time) => Date.now() - time < 1000);
    this.queue = this.queue.filter((job) => this.jobs.has(job.id));
    const ready: Job[] = [];
    const count = Math.min(
      32 - this.inFlight,
      this.perSecond - this.sentTimes.length,
    );
    while (this.queue.length && ready.length < count) {
      const job = this.queue.shift()!;
      if (job.relevant?.() === false) {
        this.finish(job);
        job.reject(cancelled());
      } else ready.push(job);
    }
    if (ready.length) this.transmit(ready);
    this.schedule();
  }

  private transmit(jobs: Job[]): void {
    if (this.closed) return;
    const frames = jobs.map((job) => {
      job.sent = true;
      this.inFlight++;
      this.sentTimes.push(Date.now());
      return {
        jsonrpc: '2.0',
        id: job.id,
        method: job.method,
        ...(job.params === undefined ? {} : { params: job.params }),
      };
    });
    try {
      this.send(JSON.stringify(frames.length === 1 ? frames[0] : frames));
    } catch {
      this.onFatal(
        new DataError('disconnected', 'Could not send data request.', true),
      );
    }
  }
}
