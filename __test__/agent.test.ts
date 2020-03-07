import * as http from 'http';
import * as https from 'http';
import AgentWrapper from '../src/agent-wrapper';

test('http URL retruns a http Agent', () => {
	const agentWrapper = new AgentWrapper({});

	const agent = agentWrapper.getAgent('http://no.ne');

	expect(agent).toBeInstanceOf(http.Agent);
});

test('https URL retruns a https Agent', () => {
	const agentWrapper = new AgentWrapper({});

	const agent = agentWrapper.getAgent('http://no.ne');

	expect(agent).toBeInstanceOf(https.Agent);
});

test('Invalid protocol causes an error', () => {
	const agentWrapper = new AgentWrapper({});

	expect(() => agentWrapper.getAgent('htps://no.ne')).toThrow();
});
