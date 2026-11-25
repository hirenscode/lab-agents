export class ConfigError extends Error {
  name = "ConfigError";
}

export class StorageError extends Error {
  name = "StorageError";
}

export class MigrationError extends StorageError {
  name = "MigrationError";
}

export class SafetyError extends Error {
  name = "SafetyError";

  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}
