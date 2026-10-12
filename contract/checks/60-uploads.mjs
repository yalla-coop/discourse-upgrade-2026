// Inventory rows 69-70 (uploads) and 18 (pick avatar, which needs an upload).
// Source: forward-trust-community-mobile-app/api/src/resolvers/upload/*,
// resolvers/user/saveProfilePictureMutation.ts, typeSchemas/UploadOutput.ts,
// typeSchemas/LookupUrl.ts. The app selects these in
// frontend/src/graphql/server/upload.ts and topics.ts (LOOKUP_URLS).
//
// Row 69 is multipart in Prose (form-data with `files[]`, `type`, `user_id`).
// The runner needs `multipart`, `file` and `fields` support for it:
//   multipart: true                 send multipart/form-data instead of a form/json body
//   file: { field, name, type, base64 }  the file part
//   fields: object or (ctx) => object    the other parts
//
// The upload is a 1x1 PNG with fixed content, so Discourse deduplicates it and
// repeat runs reuse the same upload. Users cannot delete uploads through the
// API; once the avatar is reset below it is unreferenced and Discourse's
// clean-up job removes it.

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  area: "Uploads",
  checks: [
    {
      id: 69,
      name: "Upload an image (avatar type, as the profile screen does)",
      as: "member",
      method: "POST",
      path: "/uploads.json",
      multipart: true,
      file: { field: "files[]", name: "contract.png", type: "image/png", base64: ONE_PIXEL_PNG },
      fields: (ctx) => ({ type: "avatar", user_id: ctx.memberId }),
      status: 200,
      expect: {
        id: "number",
        url: "string",
        original_filename: "string",
        filesize: "number",
        width: "number",
        height: "number",
        thumbnail_width: "number",
        thumbnail_height: "number",
        extension: "string",
        short_url: "string",
        short_path: "string|null",
        human_filesize: "string",
      },
      capture: (data, ctx) => {
        ctx.uploadId = data?.id;
        ctx.uploadShortUrl = data?.short_url;
      },
      write: true,
    },
    {
      id: 70,
      name: "Look up upload URLs",
      as: "member",
      method: "POST",
      path: "/uploads/lookup-urls.json",
      json: (ctx) => ({ short_urls: [ctx.uploadShortUrl] }),
      status: 200,
      expect: {
        "[]": "object",
        "[].short_url": "string",
        "[].url": "string",
        "[].short_path": "string",
      },
      // A read, but it needs the upload from row 69.
      write: true,
    },
    {
      id: 18,
      name: "Pick the uploaded avatar",
      as: "member",
      method: "PUT",
      path: (ctx) => `/u/${ctx.username}/preferences/avatar/pick.json`,
      json: (ctx) => ({ upload_id: ctx.uploadId, type: "uploaded" }),
      status: 200,
      expect: {},
      write: true,
    },
    {
      id: "cleanup-18",
      name: "Reset the avatar to the system avatar (cleanup, same endpoint)",
      as: "member",
      method: "PUT",
      path: (ctx) => `/u/${ctx.username}/preferences/avatar/pick.json`,
      json: { type: "system" },
      status: 200,
      expect: {},
      write: true,
    },
  ],
};
