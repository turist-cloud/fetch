import AgentWrapper from '../src/agent-wrapper';

test('Invalid protocol causes an error', () => {
	const agentWrapper = new AgentWrapper({});

	expect(() => agentWrapper.getAgent('htps://no.ne')).toThrow();
});
