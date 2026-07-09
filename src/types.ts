import type { Options as RetryOptions } from 'async-retry-ng';
import type { Dispatcher } from 'undici';
import type FetchRetryError from './fetch-retry-error';

export interface FetchOptions extends RequestInit {
	/** undici dispatcher (Agent). Injected automatically if not provided. */
	dispatcher?: Dispatcher;
	retry?: RetryOptions & { maxRetryAfter?: number };
	onRetry?: (error: FetchRetryError, opts: FetchOptions) => void;
	/**
	 * Per-request wall-clock deadline in ms. node-fetch honored a `timeout`
	 * option; undici does not, so we translate it to an AbortSignal.
	 */
	timeout?: number;
	/** Required by undici when the body is a Node stream. */
	duplex?: 'half';
	body?: any; // allows automatic JSON serialization of objects
}

export type Fetch = (url: string, options?: FetchOptions) => Promise<Response>;
