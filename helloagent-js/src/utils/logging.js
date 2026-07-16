const loggers = new Map();

export function setupLogger(name = 'hello_agents', level = 'INFO', formatString = null) {
  if (!loggers.has(name)) {
    const logger = {
      name,
      level: level.toUpperCase(),
      format: formatString || '{timestamp} - {name} - {level} - {message}',
      log(msg, msgLevel = 'INFO') {
        const timestamp = new Date().toISOString();
        const levelUpper = msgLevel.toUpperCase();
        const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        if (levels.indexOf(levelUpper) < levels.indexOf(this.level)) return;
        const output = this.format
          .replace('{timestamp}', timestamp)
          .replace('{name}', this.name)
          .replace('{level}', levelUpper)
          .replace('{message}', msg);
        console.log(output);
      },
      debug(msg) { this.log(msg, 'DEBUG'); },
      info(msg) { this.log(msg, 'INFO'); },
      warn(msg) { this.log(msg, 'WARN'); },
      error(msg) { this.log(msg, 'ERROR'); },
    };
    loggers.set(name, logger);
  }
  return loggers.get(name);
}

export function getLogger(name = 'hello_agents') {
  return setupLogger(name);
}