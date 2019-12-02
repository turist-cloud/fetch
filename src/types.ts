import * as http from 'http';
import * as https from 'http';
import { Options as RetryOptions } from 'async-retry';
import { Request, RequestInit, Response } from 'node-fetch';
import FetchRetryError from './fetch-retry-error';

export type FetchOptions = RequestInit & {
	agent?: https.Agent | http.Agent;
	retry?: RetryOptions;
	onRedirect?: (res: Response, redirectOpts: FetchOptions) => void;
	onRetry?: (error: FetchRetryError, opts: FetchOptions) => void;
}

export type Fetch = {
	(
		url: string | Request,
		options?: FetchOptions
	): Promise<Response>
}

export type AgentOptions = http.AgentOptions | https.AgentOptions;
