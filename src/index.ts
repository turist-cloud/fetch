import { resolve as resolveUrl } from 'url';
import { Headers, Response } from 'node-fetch';
import { Readable } from 'stream';
import createDebug from 'debug';
import retry from 'async-retry-ng';
import AgentWrapper from './agent-wrapper';
import { AgentOptions, Fetch, FetchOptions } from './types';
import parseHost from './parse-host';
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
	freeSocketTimeout: 30000
};

const debug = createDebug('@turist/fetch');

// If we'd accept an AgentWrapper here then redirects wouldn't need to override
function setupFetch(fetch: Fetch, agentOpts: AgentOptions = {}): any {
	const agentWrapper = new AgentWrapper({ ...AGENT_OPTIONS, ...agentOpts });

	return async function fetchWrap(url: string, fetchOpts: FetchOptions = {}): Promise<Response> {
		const opts = Object.assign({}, fetchOpts);

		if (opts.redirect) {
			if (![
				'follow', // Follow redirects
				'manual', // Do not follow redirects
				'error',  // Reject the promise on redirect
				'manual-dont-change'
			].includes(opts.redirect)) {
				throw new Error('Invalid redirect option');
			}
		}

		// @ts-ignore
		if (!opts.agent) {
			// Add default `agent` if none was provided
			opts.agent = agentWrapper.getAgent(url);
		}

		// node-fetch changes the resolves the Location header to an absolute
		// URL with `manual` but luckily an invalid value here will turn off
		// that feature.
		// @ts-ignore
		opts.redirect = 'manual-dont-change';

		opts.headers = new Headers(opts.headers);
		if (!(opts.headers instanceof Headers)) {
			throw new Error('Failed to create fetch opts');
		}

		if (!opts.headers.get('user-agent')) {
			opts.headers.set('User-Agent', 'turist-fetch/1.0 (+https://github.com/turist-cloud/fetch)');
		}

		const [newUrl, host] = await parseHost(url, opts.headers);
		opts.headers.set('host', host);

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
					res = await fetch(newUrl, opts);
					Object.defineProperty(res, 'url', {
						get: function() { return this.realUrl },
						set: function(v: string) { this.realUrl = v }
					});
					res.url = url;

					debug('status %d', res.status);
					if ((res.status >= 500 && res.status < 600) || res.status === 429) {
						throw new FetchRetryError(res);
					} else {
						return res;
					}
				} catch (err) {
					const { method = 'GET' } = opts;
					const isRetry = attempt <= retryOpts.retries;

					if (res && res.status === 429 && isRetry) {
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
			if (fetchOpts.redirect === 'manual') {
				const location = res.headers.get('location');
				if (location) {
					res.headers.set('Location', resolveUrl(url, location));
				}

				return res;
			}
			// @ts-ignore
			if (fetchOpts.redirect === 'manual-dont-change') {
				return res;
			}
			if (fetchOpts.redirect === 'error') {
				throw new Error('Redirect rejected');
			}

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
