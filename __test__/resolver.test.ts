import { isIP } from 'net';
import { Resolver } from 'dns';
import dnsResolve, { setupCache } from '../src/dns-resolve';

const domains = ['s3.amazonaws.com', 'zeit.co'];

beforeEach(setupCache);

test('should resolve domains', async () => {
	for (const domain of domains) {
		const ip = await dnsResolve(domain, {});

		expect(isIP(ip)).toBeTruthy();
	}
}, 10000);

test('should resolve using a custom resolver', async () => {
	const resolver = new Resolver();

	resolver.setServers(['8.8.8.8', '1.1.1.1']);
	for (const domain of domains) {
		// @ts-ignore
		const ip = await dnsResolve(domain, { resolver });

		expect(isIP(ip)).toBeTruthy();
	}
}, 10000);

test('repeated resolves', async () => {
	for (const domain of domains) {
		const ip = await dnsResolve(domain, {});

		for (let i = 0; i < 3; i++) {
			const ipNext = await dnsResolve(domain, {});

			expect(ipNext).toBe(ip);
		}
	}
}, 100000);

test('concurrent resolves', async () => {
	for (const domain of domains) {
		const arr = [domain, domain, domain, domain, domain];
		const res = await Promise.all(arr.map((d) => dnsResolve(d)));
		const first = res[0];

		expect(res.every((v) => v === first)).toBeTruthy();
	}
}, 10000);

test('Proper error on CNAME pointing to nowhere', async () => {
	const p = dnsResolve('dns-cached-resolve-test.zeit.rocks');
	await expect(p).rejects.toThrow('queryA ENOTFOUND dns-cached-resolve-test.zeit.rocks');
}, 10000);

test('should resolve localhost even when resolver fails to resolve localhost', async () => {
	const resolver = new Resolver();

	resolver.setServers(['8.8.8.8']);
	const domain = 'localhost'
	// @ts-ignore
	const ip = await dnsResolve(domain, { resolver });

	expect(isIP(ip)).toBeTruthy();
}, 10000);
