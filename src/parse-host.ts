import { isIP } from 'net';
import { parse as parseUrl } from 'url';
import resolve from './dns-resolve';

export default async function parseHost(url: string, headers: Headers) {
	const parsedUrl = parseUrl(url);
	const host = headers.get('host') || parsedUrl.host;

	if (!host) {
		throw new TypeError('Unable to determine Host');
	}

	headers.set('host', host);

	const ip = isIP(parsedUrl.hostname || '');
	if (ip === 0) {
		if (!parsedUrl.hostname) {
			throw new Error('Unable to determine hostname');
		}

		// We need to create a new URL object here because url.parse() doesn't
		// return a functional WHATWG URL object but something that only looks
		// similar and has the same properties.
		// TS doesn't know about the existence global WHATWG URL.
		// @ts-ignore
		const newUrl = new URL(parsedUrl.href);
		newUrl.hostname = await resolve(parsedUrl.hostname);
		url = newUrl.href;
	}

	return [url, host];
}
