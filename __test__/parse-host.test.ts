import { isIP } from 'net';
import { Headers } from 'node-fetch';
import parseHost from '../src/parse-host';

test('Parses a domain to an IP address', async () => {
	const [url, host] = await parseHost('http://google.com', new Headers());

	const ip = url.substring(7, url.length - 1);
	expect(isIP(ip)).toBeTruthy();

	expect(host).toBe('google.com');
});

test('Leaves URL with IP address as is', async () => {
	const url = 'http://127.0.0.1/this/is/path/file.txt?xyz=123&yes=no';
	const [newUrl, host] = await parseHost(url, new Headers());

	expect(newUrl).toBe(url);
	expect(host).toBe('127.0.0.1');
});

test('Ports work', async () => {
	const url = 'http://127.0.0.1:8080/this/is/path/file.txt?xyz=123&yes=no';
	const [newUrl, host] = await parseHost(url, new Headers());

	expect(newUrl).toBe(url);
	expect(host).toBe('127.0.0.1:8080');
});

test('Host header is respected', async () => {
	const url = 'https://amazon.com';
	const [newUrl, host] = await parseHost(url, new Headers({ Host: 'ebay.com' }));

	const ip = newUrl.substring(8, newUrl.length - 1);
	expect(isIP(ip)).toBeTruthy();

	expect(host).toBe('ebay.com');
});
