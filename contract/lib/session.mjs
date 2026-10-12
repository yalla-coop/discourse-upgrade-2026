// Talks to Discourse the way Prose does (forward-trust-community-mobile-app/api/src/client.ts
// and helpers/auth.ts): a cookie session, a fresh CSRF token before every
// authenticated request, and URL-encoded form bodies. No extra headers.
// Redirects are followed, as axios does by default.

function flattenForm(value, prefix, out) {
  if (Array.isArray(value)) {
    for (const item of value) flattenForm(item, `${prefix}[]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      flattenForm(inner, prefix ? `${prefix}[${key}]` : key, out);
    }
  } else if (value !== undefined) {
    out.push([prefix, String(value)]);
  }
  return out;
}

export class Session {
  constructor(baseUrl, { apiKey, apiUsername } = {}) {
    this.base = baseUrl.replace(/\/$/, "");
    this.jar = new Map();
    this.apiKey = apiKey;
    this.apiUsername = apiUsername;
  }

  absorbCookies(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async send(method, path, { form, json, multipart, headers = {} } = {}) {
    const url = `${this.base}/${path.replace(/^\//, "")}`;
    const finalHeaders = { Accept: "application/json", ...headers };
    if (this.jar.size) {
      finalHeaders.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (this.apiKey) {
      finalHeaders["Api-Key"] = this.apiKey;
      finalHeaders["Api-Username"] = this.apiUsername;
    }

    let body;
    if (multipart) {
      // multipart: { fields: {...}, file: { field, name, type, base64 } }
      body = new FormData();
      for (const [key, value] of Object.entries(multipart.fields || {})) body.append(key, String(value));
      if (multipart.file) {
        const { field = "file", name, type, base64 } = multipart.file;
        body.append(field, new Blob([Buffer.from(base64, "base64")], { type }), name);
      }
    } else if (form) {
      body = new URLSearchParams(flattenForm(form, "", [])).toString();
      finalHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (json) {
      body = JSON.stringify(json);
      finalHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(url, { method, headers: finalHeaders, body, redirect: "follow" });
    this.absorbCookies(response);
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: response.status, data, headers: response.headers };
  }

  async csrf() {
    const { data } = await this.send("GET", "/session/csrf.json");
    return data?.csrf;
  }

  // Same as Prose's getClient(): fetch a CSRF token first, then make the call.
  async request(method, path, options = {}) {
    if (this.apiKey) return this.send(method, path, options);
    const csrf = await this.csrf();
    return this.send(method, path, {
      ...options,
      headers: { "x-csrf-token": csrf, ...(options.headers || {}) },
    });
  }

  async login(login, password) {
    return this.request("POST", "/session.json", { form: { login, password } });
  }

  get loggedIn() {
    return this.jar.has("_t");
  }
}
