// Inventory rows 1-14: auth and session.
// Source: forward-trust-community-mobile-app/api/src/helpers/auth.ts,
// resolvers/auth/*, typeSchemas/LoginOutput.ts, typeSchemas/UserLite.ts.
//
// Skipped:
//   9  PUT /u/activate-account/{token}.json  needs the token from a real activation email
//   10 PUT /u/password-reset/{token}.json    needs the token from a real reset email
//   11 GET /invites/{token}                  needs a real invite (creating one sends email)
//   12 PUT /invites/show/{token}.json        same as 11
//   14 DELETE /u/{username}.json             deletes the account
// Row 6 (logout) runs at the very end, in 99-logout.mjs.

import { Session } from "../lib/session.mjs";

// Prose's UserLite declares these non-null, so login breaks if any goes missing.
const userLite = {
  "user.id": "number",
  "user.username": "string",
  "user.name": "string|null",
  "user.avatar_template": "string",
  "user.created_at": "string",
  "user.ignored": "boolean",
  "user.muted": "boolean",
  "user.can_ignore_user": "boolean",
  "user.can_mute_user": "boolean",
  "user.can_send_private_messages": "boolean",
  "user.can_send_private_message_to_user": "boolean",
  "user.trust_level": "number",
  "user.moderator": "boolean",
  "user.admin": "boolean",
  "user.badge_count": "number",
  "user.time_read": "number",
  "user.recent_time_read": "number",
  "user.can_edit": "boolean",
  "user.can_edit_username": "boolean",
  "user.can_edit_email": "boolean",
  "user.can_edit_name": "boolean",
  "user.pending_count": "number",
  "user.profile_view_count": "number",
  "user.can_upload_profile_header": "boolean",
  "user.can_upload_user_card_background": "boolean",
  "user.mailing_list_posts_per_day": "number",
  "user.groups": "array",
  "user.groups[].id": "number",
  "user.groups[].name": "string",
};

export default {
  area: "Auth",
  checks: [
    {
      id: 1,
      name: "CSRF token",
      as: "anon",
      method: "GET",
      path: "/session/csrf.json",
      status: 200,
      expect: { csrf: "string" },
    },
    {
      id: 2,
      name: "Log in",
      as: "member",
      run: async ({ member }, ctx, config) => {
        const response = await member.login(config.member.username, config.member.password);
        if (!member.loggedIn) response.problems = ["no _t session cookie after login"];
        return response;
      },
      status: 200,
      expect: { ...userLite, user_badges: "array" },
    },
    // Production today: the old path is already gone (404 with `errors`), and
    // Prose falls back to /session/hp.json because of those errors.
    {
      id: 3,
      name: "Honeypot challenge, old path (gone, Prose falls back)",
      as: "anon",
      method: "GET",
      path: "/users/hp.json",
      status: [200, 404],
      expect: {},
    },
    {
      id: 4,
      name: "Honeypot challenge, new path",
      as: "anon",
      method: "GET",
      path: "/session/hp.json",
      status: 200,
      expect: { value: "string", challenge: "string" },
    },
    {
      id: 5,
      name: "Current session (token refresh)",
      as: "member",
      method: "GET",
      path: "/session/current.json",
      status: 200,
      expect: {
        "current_user.id": "number",
        "current_user.username": "string",
        "current_user.name": "string|null",
      },
    },
    {
      id: 13,
      name: "Check username is available",
      as: "member",
      method: "GET",
      path: () => `/u/check_username?username=freename${Date.now() % 100000}`,
      status: 200,
      expect: { available: "boolean" },
    },
    {
      id: 7,
      name: "Forgot password (sends an email)",
      as: "anon",
      write: true,
      method: "POST",
      path: "/session/forgot_password.json",
      // The app sends the member's email. With hide_email_address_taken on,
      // Discourse only accepts an email here.
      json: (ctx) => ({ login: ctx.memberEmail ?? ctx.username }),
      status: 200,
      expect: { success: "string" },
    },
    {
      id: 8,
      name: "Register a new account (with honeypot)",
      as: "anon",
      write: true,
      run: async (_sessions, ctx, config) => {
        // Same steps as Prose's registerMutation: CSRF, honeypot, then POST /users.json.
        const visitor = new Session(config.base_url);
        const csrf = await visitor.csrf();
        let hp = await visitor.send("GET", "/users/hp.json", { headers: { "x-csrf-token": csrf } });
        if (hp.data?.errors) {
          hp = await visitor.send("GET", "/session/hp.json", { headers: { "x-csrf-token": csrf } });
        }
        const suffix = Date.now() % 1000000;
        ctx.registeredUsername = `contract_reg_${suffix}`;
        return visitor.send("POST", "/users.json", {
          headers: { "x-csrf-token": csrf },
          form: {
            name: "Contract Registration",
            email: `contract_reg_${suffix}@example.com`,
            username: ctx.registeredUsername,
            password: "contract-checks-2026!",
            password_confirmation: hp.data?.value,
            challenge: (hp.data?.challenge || "").split("").reverse().join(""),
          },
        });
      },
      status: 200,
      // Discourse only returns user_id to API-key callers, so Prose never sees
      // it and returns Discourse's "check your email" message to the app.
      expect: { success: "boolean", active: "boolean", message: "string" },
      cleanup: async ({ admin }, ctx) => {
        const lookup = await admin.request("GET", `/u/${ctx.registeredUsername}.json`);
        const id = lookup.data?.user?.id;
        if (id) {
          await admin.request("DELETE", `/admin/users/${id}.json`, {
            form: { context: "contract check cleanup" },
          });
        }
      },
    },
  ],
};
