import { Agent, type Dispatcher } from 'undici';
import { createCachingLookup } from './caching-lookup';

/**
 * Legacy agentkeepalive-style options that older @turist/fetch (node-fetch v2)
 * accepted, kept for backwards compatibility and mapped onto undici's Agent.
 */
export interface LegacyAgentOptions {
	/** Max connections per origin (agentkeepalive `maxSockets`). */
	maxSockets?: number;
	/** Idle keep-alive socket timeout, ms (agentkeepalive `freeSocketTimeout`). */
	freeSocketTimeout?: number;
	/** Active socket timeout, ms (agentkeepalive `timeout`). */
	timeout?: number;
}

export type AgentOptions = Agent.Options & LegacyAgentOptions;

const DEFAULT_KEEP_ALIVE_TIMEOUT = 30_000;
const DEFAULT_CONNECTIONS = 128;

/**
 * Create the undici Agent used as the default dispatcher. DNS caching lives here
 * (via `connect.lookup`) so it applies to every request AND every redirect hop
 * undici follows internally.
 */
export function createDispatcher(agentOpts: AgentOptions = {}): Dispatcher {
	const {
		maxSockets,
		freeSocketTimeout,
		timeout,
		connect: userConnect,
		...undiciOpts
	} = agentOpts;

	// A user-supplied connect.lookup wins; otherwise install the caching lookup.
	const connect = {
		lookup: createCachingLookup(),
		...(typeof userConnect === 'object' ? userConnect : {}),
	};

	return new Agent({
		keepAliveTimeout:
			freeSocketTimeout ?? timeout ?? DEFAULT_KEEP_ALIVE_TIMEOUT,
		connections: maxSockets ?? DEFAULT_CONNECTIONS,
		...undiciOpts,
		connect,
	});
}
