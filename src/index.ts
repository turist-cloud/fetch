import { Readable } from 'stream';
import createDebug from 'debug';
import retry from 'async-retry-ng';
import { fetch as undiciFetch, Headers } from 'undici';
import { AgentOptions, createDispatcher } from './create-dispatcher';
import { Fetch, FetchOptions } from './types';
import FetchRetryError from './fetch-retry-error';

// retry settings
const MIN_TIMEOUT = 10;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER = 30000;
const FACTOR = 5;

const VALID_REDIRECTS = ['follow', 'manual', 'error'];

const debug = createDebug('@turist/fetch');

function setupFetch(fetch: Fetch, agentOpts: AgentOptions = {}): Fetch {
	// DNS caching + keep-alive pooling live in this dispatcher and apply to
	// every request and every redirect hop undici follows internally. That is
	// why we no longer need the manual redirect / URL-rewrite dance the
	// node-fetch version required.
	const dispatcher = createDispatcher(agentOpts);

	return async function fetchWrap(
		url: string,
		fetchOpts: FetchOptions = {}
	): Promise<Response> {
		const opts: FetchOptions = Object.assign({}, fetchOpts);

		if (opts.redirect && !VALID_REDIRECTS.includes(opts.redirect)) {
			throw new Error('Invalid redirect option');
		}

		if (!opts.dispatcher) {
			opts.dispatcher = dispatcher;
		}

		// Cast: global RequestInit's HeadersInit vs undici's are structurally
		// identical but nominally distinct.
		opts.headers = new Headers(opts.headers as ConstructorParameters<typeof Headers>[0]);
		if (!opts.headers.get('user-agent')) {
			opts.headers.set(
				'User-Agent',
				'turist-fetch/2.0 (+https://github.com/turist-cloud/fetch)'
			);
		}

		// Convert Object bodies to JSON (undici would otherwise send
		// "[object Object]"). Streams/Buffers/typed arrays pass through.
		if (
			opts.body &&
			typeof opts.body === 'object' &&
			!Buffer.isBuffer(opts.body) &&
			!(opts.body instanceof Readable) &&
			!(opts.body instanceof Uint8Array)
		) {
			opts.body = JSON.stringify(opts.body);
			if (!opts.headers.get('content-type')) {
				opts.headers.set('Content-Type', 'application/json');
			}
		}

		// undici requires `duplex: 'half'` to send a streaming request body.
		if (opts.body instanceof Readable && !opts.duplex) {
			opts.duplex = 'half';
		}

		// node-fetch honored a per-request `timeout`; undici uses AbortSignal.
		if (typeof opts.timeout === 'number') {
			const timeoutSignal = AbortSignal.timeout(opts.timeout);
			opts.signal = opts.signal
				? AbortSignal.any([opts.signal, timeoutSignal])
				: timeoutSignal;
			delete opts.timeout;
		}

		const retryOpts = Object.assign(
			{
				minTimeout: MIN_TIMEOUT,
				retries: MAX_RETRIES,
				factor: FACTOR,
				maxRetryAfter: MAX_RETRY_AFTER,
			},
			opts.retry
		);

		if (opts.onRetry) {
			// `any` avoids the Error vs FetchRetryError type mismatch.
			retryOpts.onRetry = (error: any) => {
				if (opts.onRetry) {
					opts.onRetry(error, opts);
					if (opts.retry && opts.retry.onRetry) {
						opts.retry.onRetry(error);
					}
				}
			};
		}

		// These are consumed here, not by fetch() — strip before dispatch.
		delete opts.retry;
		delete opts.onRetry;

		debug('%s %s', opts.method || 'GET', url);
		try {
			return await retry(async (_bail, attempt) => {
				let res: Response | undefined;
				try {
					res = await fetch(url, opts);

					debug('status %d', res.status);
					if ((res.status >= 500 && res.status < 600) || res.status === 429) {
						throw new FetchRetryError(res);
					}
					return res;
				} catch (err: any) {
					const { method = 'GET' } = opts;
					const isRetry = attempt <= retryOpts.retries;

					if (res && res.status === 429 && isRetry) {
						const retryAfter = parseInt(
							res.headers.get('retry-after') ?? '',
							10
						);
						if (retryAfter) {
							const delay = Math.min(
								retryAfter * 1000,
								retryOpts.maxRetryAfter
							);
							await new Promise((r) => setTimeout(r, delay));
						}
					}

					debug(
						`${method} ${url} error (${err.status}). ${
							isRetry ? 'retrying' : ''
						}`,
						err
					);

					throw err;
				}
			}, retryOpts);
		} catch (err) {
			if (err instanceof FetchRetryError) {
				return err.res;
			}
			throw err;
		}
	};
}

export default function setup(fetch?: Fetch, options?: AgentOptions): Fetch {
	const impl = (fetch ?? (undiciFetch as unknown as Fetch)) as Fetch;

	if (typeof impl !== 'function') {
		throw new Error(
			"fetch() argument isn't a function; did you forget to initialize your @turist/fetch import?"
		);
	}

	return setupFetch(impl, options);
}
