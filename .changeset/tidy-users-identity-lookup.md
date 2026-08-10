---
'@logto/core': minor
---

support finding users by social identity on `GET /api/users`

Add optional `identityTarget` and `identityUserId` query parameters so Management API clients can resolve a Logto user from a linked social identity. Both parameters must be provided together, and they cannot be combined with other user search filters.
