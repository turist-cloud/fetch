import { parse as parseUrl } from 'url';
import { Headers, Response } from 'node-fetch';
import AgentWrapper from './agent-wrapper';
import { FetchOptions } from './types';

export const isRedirect = (v: number) => ((v / 100) | 0) === 3

export function makeRedirectOpts(res: Response, opts: FetchOptions, agentWrapper: AgentWrapper): [string, FetchOptions] {
	const redirectOpts = Object.assign({}, opts);
	redirectOpts.headers = new Headers(opts.headers);

	// per fetch spec, for POST request with 301/302 response,
	// or any request with 303 response, use GET when following redirect
	if (
		res.status === 303 ||
		((res.status === 301 || res.status === 302) && opts.method === 'POST')
	) {
		redirectOpts.method = 'GET';
		redirectOpts.headers.delete('content-length');
		delete redirectOpts.body;
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

	// TODO This might actually override user-provided agent
	redirectOpts.agent = agentWrapper.getAgent(location);

	if (opts.onRedirect) {
		opts.onRedirect(res, redirectOpts);
	}

	return [location, redirectOpts];
}
