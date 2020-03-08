import AgentWrapper from '../src/agent-wrapper';
import { Response } from 'node-fetch';
import { isRedirect, makeRedirectOpts } from '../src/redirect';

describe('isRedirect()', () => {
	test('404 is not a redirect', () => {
		const is = isRedirect(404);

		expect(is).toBeFalsy();
	});

	test('300 is a redirect', () => {
		const is = isRedirect(300);

		expect(is).toBeTruthy();
	});

	test('301 is a redirect', () => {
		const is = isRedirect(301);

		expect(is).toBeTruthy();
	});
});

describe('makeRedirectOpts()', () => {
	let agentWrapper = new AgentWrapper({});

	test('303 turns redirect request into a GET', () => {
		const res = new Response(undefined, {
			headers: {
				Location: 'https://no.ne'
			},
			status: 303
		});
		const opts = {
			method: 'HEAD'
		};

		const [location, redirectOpts] = makeRedirectOpts(res, opts, agentWrapper);

		expect(location).toBe('https://no.ne/');
		expect(redirectOpts.method).toBe('GET');
	});

	test('301 turns POST into a GET on redirect', () => {
		const body = 'test';
		const res = new Response(undefined, {
			headers: {
				Location: 'https://no.ne',
				'Content-Length': `${Buffer.from(body).length}`
			},
			status: 301
		});
		const opts = {
			method: 'POST',
			body
		};

		const [location, redirectOpts] = makeRedirectOpts(res, opts, agentWrapper);

		expect(location).toBe('https://no.ne/');
		expect(redirectOpts.method).toBe('GET');
		expect(redirectOpts.body).not.toBeDefined();

		const headers = redirectOpts.headers;
		expect(headers).toBeDefined();
		// @ts-ignore
		expect(headers.get('content-length')).toBeNull();
	});

	test('Throws if there is no Location on 300', () => {
		const res = new Response(undefined, {
			status: 300
		});
		const opts = {
			method: 'GET'
		};

		expect(() => makeRedirectOpts(res, opts, agentWrapper)).toThrow();
	});
});
