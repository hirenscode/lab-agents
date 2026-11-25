export class ConfigError extends Error {
  name = "ConfigError";
}

export class StorageError extends Error {
  name = "StorageError";
}

export class MigrationError extends StorageError {
  name = "MigrationError";
}
