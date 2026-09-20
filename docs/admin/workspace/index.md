# Workspace Deployment Scenarios

Workspace deployments are focused on user workspace access patterns and
identity providers.

## Available Workspace Scenarios

| Scenario                                           | Purpose                                       |
| :------------------------------------------------- | :-------------------------------------------- |
| [Dex localhost](localhost/install.md)              | Single-user local workspace deployment        |
| [Keycloak secure server](secure-server/install.md) | Multi-user secure server deployment with OIDC |

## Writes From the Client, and Jupyter XSRF Protection

The Building Models page writes a converted model back into the user's library,
through the workspace's own Jupyter Contents API. That is the only place the web
client writes to a workspace.

The Jupyter server can guard writes with a token it sets as the `_xsrf` cookie
and expects echoed in an `X-XSRFToken` header. **The workspace image DTaaS ships
sets no such cookie and accepts the write**, so the client sends the header when
the cookie is readable and leaves it out when it is not. That is a deployment
assumption, and it is written here because it is load-bearing.

On a workspace that does enable the protection, the cookie is `HttpOnly`, script
cannot read it, the header is omitted, and every write is refused. Nothing
breaks: the page still draws the model, it simply converts it again on the next
visit instead of loading a stored file. The refusal is written to the browser
console, so the two cases can be told apart.

If you enable XSRF protection on a workspace and want conversions to persist,
produce the `.glb` files outside the browser instead, which is the better route
for a large model in any case.

## Notes

- Use workspace scenarios when the primary focus is workspace auth and
  per-user route access.
- Also see DTaaS package deployments that include the full DTaaS web platform for
  [localhost](../dtaas/localhost/install.md),
  [secure multi-user](../dtaas/secure-server/install.md), and
  [secure multi-user with integrated GitLab](../dtaas/secure-server-gitlab/install.md)
