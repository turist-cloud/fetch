import type { LookupFunction } from 'net';
import dnsResolve, { localhostRegex } from './dns-resolve';

/**
 * Build a `dns.lookup`-compatible function backed by turist's TTL-aware LRU DNS
 * cache. undici's Agent accepts this via `connect: { lookup }` and connects to
 * the returned IP while keeping the original hostname for TLS SNI — so we get
 * DNS caching WITHOUT rewriting the request URL (the node-fetch-era approach,
 * which broke SNI on HTTPS).
 */
export function createCachingLookup(): LookupFunction {
	return function lookup(hostname, options, callback) {
		// net/tls always call with an options object, but be defensive.
		const opts = typeof options === 'function' ? {} : options || {};
		const cb = (typeof options === 'function' ? options : callback) as (
			err: NodeJS.ErrnoException | null,
			address: any,
			family?: number
		) => void;
		const wantsV6 = opts.family === 6;
		const family = wantsV6 ? 6 : 4;

		if (localhostRegex.test(hostname)) {
			const address = wantsV6 ? '::1' : '127.0.0.1';
			return cb(null, opts.all ? [{ address, family }] : address, family);
		}

		dnsResolve(hostname, { ipv6: wantsV6 })
			.then((address) => {
				cb(null, opts.all ? [{ address, family }] : address, family);
			})
			.catch((err: NodeJS.ErrnoException) => {
				cb(err, '', 0);
			});
	};
}
