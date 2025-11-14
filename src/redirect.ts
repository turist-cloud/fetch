import { URL } from 'url';
import { Headers, Response } from 'node-fetch';
import AgentWrapper from './agent-wrapper';
import { FetchOptions } from './types';

export const isRedirect = (v: number) => [300, 303, 301, 307, 302, 305, 308].includes(v);

export function makeRedirectOpts(res: Response, opts: FetchOptions, agentWrapper: AgentWrapper): [string, FetchOptions] {
	const redirectOpts = Object.assign({}, opts);
	redirectOpts.headers = new Headers(opts.headers);
	// Make sure we follow the redirect. Doing this here also allows the user to
	// change the option in onRedirect().
	redirectOpts.redirect = 'follow';

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
	// Handle both absolute and relative URLs
	// If location is absolute, use it directly; if relative, resolve against res.url
	const locationUrl = new URL(location, res.url || 'http://placeholder').href;

	const host = new URL(locationUrl).host;
	if (!host) {
		throw new Error('Cannot determine Host');
	}

	redirectOpts.headers.set('Host', host);

	// TODO This might actually override user-provided agent
	redirectOpts.agent = agentWrapper.getAgent(locationUrl);

	if (opts.onRedirect) {
		opts.onRedirect(res, redirectOpts);
	}

	return [locationUrl, redirectOpts];
}
