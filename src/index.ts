import { isIP } from 'net';
import { parse as parseUrl, format as formatUrl } from 'url';
import { Headers, Response } from 'node-fetch';
import { Readable } from 'stream';
import createDebug from 'debug';
import retry from 'async-retry-ng';
import AgentWrapper from './agent-wrapper';
import { AgentOptions, Fetch, FetchOptions } from './types';
import resolve from './dns-resolve';
import FetchRetryError from './fetch-retry-error';
import { isRedirect, makeRedirectOpts } from './redirect';

// retry settings
const MIN_TIMEOUT = 10;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER = 30000;
const FACTOR = 5;

const AGENT_OPTIONS = {
	maxSockets: 50,
	maxFreeSockets: 20,
	timeout: 60000,
	freeSocketTimeout: 30000,
	freeSocketKeepAliveTimeout: 30000 // free socket keepalive for 30 seconds
};

const debug = createDebug('@turist/fetch');

// If we'd accept an AgentWrapper here then redirects wouldn't need to override
function setupFetch(fetch: Fetch, agentOpts: AgentOptions = {}): any {
	const agentWrapper = new AgentWrapper({ ...AGENT_OPTIONS, ...agentOpts });

	return async function fetchWrap(url: string, opts: FetchOptions = {}): Promise<Response> {
		// @ts-ignore
		if (!opts.agent) {
			// Add default `agent` if none was provided
			opts.agent = agentWrapper.getAgent(url);
		}

		opts.redirect = 'manual';

		opts.headers = new Headers(opts.headers);
		if (!(opts.headers instanceof Headers)) {
			throw new Error('Failed to create fetch opts');
		}

		// Workaround for node-fetch + agentkeepalive bug/issue
		const parsedUrl = parseUrl(url);
		const host = opts.headers.get('host') || parsedUrl.host;

		if (!host) {
			throw new TypeError('Unable to determine Host');
		}

		opts.headers.set('host', host);

		const ip = isIP(parsedUrl.hostname || '');
		if (ip === 0) {
			if (!parsedUrl.hostname) {
				throw new Error('Unable to determine hostname');
			}

			parsedUrl.hostname = await resolve(parsedUrl.hostname);
			url = formatUrl(parsedUrl);
		}

		// Convert Object bodies to JSON
		if (opts.body && typeof opts.body === 'object' && !(Buffer.isBuffer(opts.body) || opts.body instanceof Readable)) {
			opts.body = JSON.stringify(opts.body);
			opts.headers.set('Content-Type', 'application/json');
			opts.headers.set('Content-Length', `${Buffer.byteLength(opts.body)}`);
		}

		const retryOpts = Object.assign({
			minTimeout: MIN_TIMEOUT,
			retries: MAX_RETRIES,
			factor: FACTOR,
			maxRetryAfter: MAX_RETRY_AFTER,
		}, opts.retry);

		if (opts.onRetry) {
			// Using `any` here to avoid type mismatch between
			// Error and FetchRetryError
			retryOpts.onRetry = (error: any) => {
				if (opts.onRetry) {
					opts.onRetry(error, opts);
					if (opts.retry && opts.retry.onRetry) {
						opts.retry.onRetry(error);
					}
				}
			}
		}

		debug('%s %s', opts.method || 'GET', url);
		let res: Response;
		try {
			res = await retry(async (_bail, attempt) => {
				try {
					res = await fetch(url, opts);

					debug('status %d', res.status);
					if ((res.status >= 500 && res.status < 600) || res.status === 429) {
						throw new FetchRetryError(res);
					} else {
						return res;
					}
				} catch (err) {
					const { method = 'GET' } = opts;
					const isRetry = attempt <= retryOpts.retries;

					if (res.status === 429 && isRetry) {
						const retryAfter = parseInt(res.headers.get('retry-after') ?? '', 10);
						if (retryAfter) {
							const delay = Math.min(retryAfter * 1000, retryOpts.maxRetryAfter);
							await new Promise(r => setTimeout(r, delay));
						}
					}

					debug(`${method} ${url} error (${err.status}). ${isRetry ? 'retrying' : ''}`, err);

					throw err;
				}
			}, retryOpts);
		} catch (err) {
			if (err instanceof FetchRetryError) {
				return err.res;
			}

			throw err;
		}

		if (isRedirect(res.status)) {
			// TODO Loop detection
			return fetchWrap(...makeRedirectOpts(res, opts, agentWrapper));
		} else {
			return res;
		}
	};
}

export default function setup(fetch?: Fetch, options?: AgentOptions): Fetch {
	if (!fetch) {
		fetch = require('node-fetch');
	}

	// @ts-ignore
	const fd = fetch.default;
	if (fd) {
		// combines "fetch.Headers" with "fetch.default" function.
		// workaround for "fetch.Headers is not a constructor"
		fetch = Object.assign((...args: unknown[]) => fd(...args), fd, fetch);
	}

	if (typeof fetch !== 'function') {
		throw new Error(
			"fetch() argument isn't a function; did you forget to initialize your @zeit/fetch import?"
		);
	}

	fetch = setupFetch(fetch, options);

	if (!fetch) {
		throw new Error('Unable to setup fetch');
	}

	return fetch;
}
