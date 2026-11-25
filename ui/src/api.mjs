export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || "Lab Agents could not complete the request.");
    this.status = status;
    this.code = data?.code;
  }
}

export function createApi(csrfToken) {
  return async (path, { method = "GET", body, signal } = {}) => {
    const headers = {};
    if (csrfToken && method !== "GET") headers["x-csrf-token"] = csrfToken;
    if (body !== undefined) headers["content-type"] = "application/json";
    const result = await fetch("/api" + path, {
      method, headers, signal, credentials: "same-origin",
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (result.status === 204) return null;
    const data = await result.json().catch(() => null);
    if (!result.ok) throw new ApiError(result.status, data);
    return data;
  };
}
