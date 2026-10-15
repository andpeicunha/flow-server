import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

export function oauthConfig(env) {
  const issuer = env.OAUTH_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) return null;
  const resource = env.OAUTH_RESOURCE?.trim();
  const allowedSubjects = new Set((env.OAUTH_ALLOWED_SUBJECTS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!resource) throw new Error("OAUTH_RESOURCE is required when OAUTH_ISSUER is set.");
  if (!allowedSubjects.size) throw new Error("OAUTH_ALLOWED_SUBJECTS is required when OAUTH_ISSUER is set.");
  return { issuer, resource, allowedSubjects, jwks: createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) };
}

export function protectedResourceMetadata({ resource, issuer }) {
  return { resource, authorization_servers: [issuer], bearer_methods_supported: ["header"] };
}

export function metadataUrl(resource) {
  const { origin, pathname } = new URL(resource);
  return `${origin}/.well-known/oauth-protected-resource${pathname === "/" ? "" : pathname}`;
}

export function challenge(oauth) {
  return oauth ? `Bearer resource_metadata="${metadataUrl(oauth.resource)}"` : "Bearer";
}

function sameToken(presented, expected) {
  const actual = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export async function authenticateBearer(presented, { accessToken, oauth }) {
  if (!presented) throw new Error("Missing bearer token.");
  if (sameToken(presented, accessToken)) return { subject: "token-user" };
  if (!oauth) throw new Error("Invalid bearer token.");
  const { payload } = await jwtVerify(presented, oauth.jwks, { issuer: oauth.issuer, audience: oauth.resource, algorithms: ["RS256"] });
  if (!payload.sub || !oauth.allowedSubjects.has(payload.sub)) throw new Error("Subject is not allowed.");
  return { subject: payload.sub };
}
