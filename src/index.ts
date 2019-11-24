import { isIP } from 'net';
import * as http from 'http';
import * as https from 'http';
import { parse as parseUrl, format as formatUrl } from 'url';
import HttpAgent from 'agentkeepalive';
import { Headers, Response } from 'node-fetch';
const {Readable} = require('stream');
import createDebug from 'debug';
import retry from 'async-retry';
import { AgentOptions, Fetch, FetchOptions } from './types';
import resolve from './dns-resolve';
import FetchRetryError from './fetch-retry-error';

// retry settings
const MIN_TIMEOUT = 10;
const MAX_RETRIES = 3;
const FACTOR = 5;

const debug = createDebug('@zeit/fetch');
const isRedirect = (v: number) => ((v / 100) | 0) === 3

const AGENT_OPTIONS = {
	maxSockets: 50,
	maxFreeSockets: 20,
	timeout: 60000,
	freeSocketTimeout: 30000,
	freeSocketKeepAliveTimeout: 30000 // free socket keepalive for 30 seconds
};

let defaultHttpGlobalAgent: http.Agent;
let defaultHttpsGlobalAgent: https.Agent;

function getDefaultHttpGlobalAgent(agentOpts: http.AgentOptions) {
	return defaultHttpGlobalAgent = defaultHttpGlobalAgent ||
		(debug('init http agent'), new HttpAgent(agentOpts));
}

function getDefaultHttpsGlobalAgent(agentOpts: https.AgentOptions) {
	return defaultHttpsGlobalAgent = defaultHttpsGlobalAgent ||
		// @ts-ignore
		(debug('init https agent'), new HttpAgent.HttpsAgent(agentOpts));
}

function getAgent(url: string, agentOpts: AgentOptions) {
	return /^https/.test(url)
		? getDefaultHttpsGlobalAgent(agentOpts)
		: getDefaultHttpGlobalAgent(agentOpts);
}

function setupFetch(fetch: Fetch, agentOpts: AgentOptions = {}): any {
	return async function fetchWrap(url: string, opts: FetchOptions = {}): Promise<Response> {
		// @ts-ignore
		if (!opts.agent) {
			// Add default `agent` if none was provided
			// @ts-ignore
			opts.agent = getAgent(url, { AGENT_OPTIONS, ...agentOpts });
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

		// Check the agent on redirections
		opts.onRedirect = (res: Response, redirectOpts: FetchOptions) => {
			const location = res.headers.get('Location');

			if (!location) {
				throw new Error('Redirect failed');
			}

			redirectOpts.agent = getAgent(location, agentOpts);
		};

		const retryOpts = Object.assign({
			// timeouts will be [ 10, 50, 250 ]
			minTimeout: MIN_TIMEOUT,
			retries: MAX_RETRIES,
			factor: FACTOR,
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
		const res = await retry(async (_bail, attempt) => {
			const isRetry = attempt < retryOpts.retries;

			try {
				const res = await fetch(url, opts);

				debug('status %d', res.status);
				if (res.status >= 500 && res.status < 600 && isRetry) {
					throw new FetchRetryError(url, res.status, res.statusText);
				} else {
					return res;
				}
			} catch (err) {
				const { method = 'GET' } = opts;
				debug(`${method} ${url} error (${err.status}). ${isRetry ? 'retrying' : ''}`, err);
				throw err;
			}
		}, retryOpts);

		if (isRedirect(res.status)) {
			const redirectOpts = Object.assign({}, opts);
			redirectOpts.headers = new Headers(opts.headers);

			// per fetch spec, for POST request with 301/302 response, or any request with 303 response, use GET when following redirect
			if (
				res.status === 303 ||
				((res.status === 301 || res.status === 302) && opts.method === 'POST')
			) {
				redirectOpts.method = 'GET';
				redirectOpts.body = undefined;
				redirectOpts.headers.delete('content-length');
			}

			const location = res.headers.get('Location');
			if (!location) {
				throw new Error('"Location" header is missing');
			}

			const host = parseUrl(location).host;
			if (!host) {
				throw new Error('Cannot determine Host');
			}

			redirectOpts.headers.set('Host', host);

			if (opts.onRedirect) {
				opts.onRedirect(res, redirectOpts);
			}

			// TODO Loop detection
			return fetchWrap(location, redirectOpts);
		} else {
			return res;
		}
	};
}

export default function setup(fetch: Fetch, options?: AgentOptions): Fetch {
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

	return fetch;
}
