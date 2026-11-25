import { SafetyError } from "../errors.mjs";

const permissions = new Set(["read", "propose", "write"]);

export function assertPermission(granted, required) {
  if (!permissions.has(required) || granted !== required) {
    throw new SafetyError("permission_denied", "The tool permission does not allow this action");
  }
}
