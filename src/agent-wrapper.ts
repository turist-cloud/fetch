import * as http from 'http';
import * as https from 'http';
import HttpAgent from 'agentkeepalive';
import { AgentOptions } from './types';

export default class Agent {
	defaultHttpAgent: http.Agent;
	defaultHttpsAgent: https.Agent;

	constructor(agentOpts: AgentOptions) {
		this.defaultHttpAgent = new HttpAgent(agentOpts);
		// @ts-ignore
		this.defaultHttpsAgent = new HttpAgent.HttpsAgent(agentOpts);
	}

	getAgent(url: string) {
		if (url.startsWith('https:')) {
			return this.defaultHttpsAgent;
		} else if (url.startsWith('http:')) {
			return this.defaultHttpAgent;
		} else {
			throw new Error('Unknown protocol');
		}
	}
}
