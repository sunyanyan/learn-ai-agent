import { Message } from './message.js';
import { Config } from './config.js';

export class Agent {
  constructor({ name, llm, systemPrompt = null, config = null }) {
    this.name = name;
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.config = config || new Config();
    this._history = [];
  }

  async run(inputText, kwargs = {}) {
    throw new Error(`${this.constructor.name} must implement run()`);
  }

  addMessage(message) {
    this._history.push(message);
  }

  clearHistory() {
    this._history = [];
  }

  getHistory() {
    return [...this._history];
  }

  toString() {
    return `Agent(name=${this.name}, provider=${this.llm.provider})`;
  }
}