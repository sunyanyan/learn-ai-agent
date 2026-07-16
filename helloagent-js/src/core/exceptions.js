/**
 * 异常体系 - HelloAgents JS
 */

export class HelloAgentsException extends Error {
  constructor(message) {
    super(message);
    this.name = 'HelloAgentsException';
  }
}

export class LLMException extends HelloAgentsException {
  constructor(message) {
    super(message);
    this.name = 'LLMException';
  }
}

export class AgentException extends HelloAgentsException {
  constructor(message) {
    super(message);
    this.name = 'AgentException';
  }
}

export class ConfigException extends HelloAgentsException {
  constructor(message) {
    super(message);
    this.name = 'ConfigException';
  }
}

export class ToolException extends HelloAgentsException {
  constructor(message) {
    super(message);
    this.name = 'ToolException';
  }
}