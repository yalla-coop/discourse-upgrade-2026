// Inventory row 6: log out. Runs last because it ends the member's session.
// Source: forward-trust-community-mobile-app/api/src/resolvers/auth/logoutMutation.ts

export default {
  area: "Logout",
  checks: [
    {
      id: 6,
      name: "Log out",
      as: "member",
      method: "DELETE",
      path: (ctx) => `/session/${ctx.username}.json`,
      // Production today answers with a 302 redirect. Axios follows it keeping
      // the DELETE method, which ends in a 404, so Prose's logoutMutation catches
      // an error and returns "failed" even though the session is destroyed
      // (the next check proves it is). Recorded as it is today.
      status: [200, 204, 302, 404],
      expect: {},
    },
    {
      id: 6,
      name: "Session is gone after logout",
      as: "member",
      method: "GET",
      path: "/session/current.json",
      status: [403, 404],
      expect: {},
    },
  ],
};
