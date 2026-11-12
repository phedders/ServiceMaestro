import type { FastifyInstance } from "fastify";
import {
  changePasswordSchema,
  loginSchema,
  passkeyLoginOptionsSchema,
  passkeyLoginVerifySchema,
  passkeyRegistrationVerifySchema,
} from "@sm/shared";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "../db.js";
import { hashPassword, verifyPassword } from "../password.js";
import {
  createSession,
  deleteUserSessions,
  destroySession,
  makeSessionCookie,
  parseCookies,
  requireAuth,
  userForRequest,
} from "../auth.js";
import { COOKIE_NAME } from "../config.js";
import { logActivity } from "../activity.js";
import {
  getUserById,
  getUserByUsername,
  mapUser,
} from "../users.js";
import {
  deletePasskey,
  getPasskeyByCredential,
  listPasskeyRows,
  listPasskeys,
  relyingParty,
  storeChallenge,
  storePasskey,
  takeChallenge,
  toWebAuthnCredential,
  updatePasskeyUsage,
} from "../passkeys.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid credentials" });

    const row = getUserByUsername(parsed.data.username);
    if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
      logActivity({
        request,
        username: parsed.data.username,
        action: "login_failed",
        module: "auth",
        status: 401,
        detail: "Invalid username or password",
      });
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const session = createSession(row.id);
    const cookie = makeSessionCookie(session.token);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    const user = mapUser(row);
    logActivity({
      request,
      user,
      action: "login",
      module: "auth",
      status: 200,
      detail: "Password login",
    });
    return { user };
  });

  app.post("/api/auth/password", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid password change", issues: parsed.error.issues });
    }
    const user = request.user!;
    const row = getUserByUsername(user.username);
    if (!row || !verifyPassword(parsed.data.currentPassword, row.password_hash)) {
      return reply.code(400).send({ error: "Current password is incorrect" });
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(parsed.data.newPassword),
      user.id,
    );
    const currentToken = parseCookies(request.headers.cookie)[COOKIE_NAME];
    deleteUserSessions(user.id, currentToken);
    return { ok: true };
  });

  app.post("/api/auth/passkey/login/options", async (request, reply) => {
    const parsed = passkeyLoginOptionsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid passkey request" });
    const row = getUserByUsername(parsed.data.username);
    if (!row) return reply.code(404).send({ error: "No passkey is registered for that username" });
    const passkeys = listPasskeyRows(row.id);
    if (!passkeys.length) {
      return reply.code(404).send({ error: "No passkey is registered for that username" });
    }
    const rp = relyingParty(request);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      allowCredentials: passkeys.map((passkey) => ({
        id: passkey.credential_id,
        transports: toWebAuthnCredential(passkey).transports,
      })),
      userVerification: "preferred",
    });
    storeChallenge(`authentication:${row.id}`, options.challenge);
    return { options };
  });

  app.post("/api/auth/passkey/login/verify", async (request, reply) => {
    const parsed = passkeyLoginVerifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid passkey response" });
    const row = getUserByUsername(parsed.data.username);
    if (!row) {
      logActivity({
        request,
        username: parsed.data.username,
        action: "passkey_login_failed",
        module: "auth",
        status: 401,
        detail: "Unknown username",
      });
      return reply.code(401).send({ error: "Passkey login failed" });
    }
    const response = parsed.data.response as AuthenticationResponseJSON;
    if (!response || typeof response.id !== "string") {
      return reply.code(400).send({ error: "Invalid passkey response" });
    }
    const passkey = getPasskeyByCredential(row.id, response.id);
    if (!passkey) {
      logActivity({
        request,
        user: mapUser(row),
        action: "passkey_login_failed",
        module: "auth",
        status: 401,
        detail: "Credential not found",
      });
      return reply.code(401).send({ error: "Passkey login failed" });
    }
    const challenge = takeChallenge(`authentication:${row.id}`);
    if (!challenge) return reply.code(400).send({ error: "Passkey challenge expired" });
    const rp = relyingParty(request);
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential: toWebAuthnCredential(passkey),
        requireUserVerification: false,
      });
      if (!result.verified) {
        logActivity({
          request,
          user: mapUser(row),
          action: "passkey_login_failed",
          module: "auth",
          status: 401,
          detail: "Verification failed",
        });
        return reply.code(401).send({ error: "Passkey login failed" });
      }
      updatePasskeyUsage(row.id, response.id, result.authenticationInfo.newCounter);
    } catch {
      logActivity({
        request,
        user: mapUser(row),
        action: "passkey_login_failed",
        module: "auth",
        status: 401,
        detail: "Verification error",
      });
      return reply.code(401).send({ error: "Passkey login failed" });
    }
    const session = createSession(row.id);
    const cookie = makeSessionCookie(session.token);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    const user = mapUser(row);
    logActivity({
      request,
      user,
      action: "passkey_login",
      module: "auth",
      status: 200,
      detail: "Passkey login",
    });
    return { user };
  });

  app.get("/api/auth/passkeys", { preHandler: requireAuth }, async (request) => ({
    passkeys: listPasskeys(request.user!.id),
  }));

  app.post(
    "/api/auth/passkeys/options",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user!;
      const row = getUserById(user.id);
      if (!row) return reply.code(401).send({ error: "Unauthorized" });
      const rp = relyingParty(request);
      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userID: new TextEncoder().encode(row.id),
        userName: row.username,
        userDisplayName: row.username,
        attestationType: "none",
        excludeCredentials: listPasskeyRows(row.id).map((passkey) => ({
          id: passkey.credential_id,
          transports: toWebAuthnCredential(passkey).transports,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });
      storeChallenge(`registration:${row.id}`, options.challenge);
      return { options };
    },
  );

  app.post(
    "/api/auth/passkeys/verify",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = passkeyRegistrationVerifySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid passkey response" });
      const user = request.user!;
      const challenge = takeChallenge(`registration:${user.id}`);
      if (!challenge) return reply.code(400).send({ error: "Passkey challenge expired" });
      const rp = relyingParty(request);
      try {
        const result = await verifyRegistrationResponse({
          response: parsed.data.response as RegistrationResponseJSON,
          expectedChallenge: challenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpID,
          requireUserVerification: false,
        });
        if (!result.verified || !result.registrationInfo) {
          return reply.code(400).send({ error: "Passkey registration failed" });
        }
        const passkey = storePasskey(
          user.id,
          result.registrationInfo.credential,
          parsed.data.name ?? "Passkey",
        );
        logActivity({
          request,
          user,
          action: "passkey_register",
          module: "auth",
          status: 201,
          detail: passkey.name,
        });
        return reply.code(201).send({ passkey });
      } catch {
        return reply.code(400).send({ error: "Passkey registration failed" });
      }
    },
  );

  app.delete(
    "/api/auth/passkeys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!deletePasskey(request.user!.id, (request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Passkey not found" });
      }
      logActivity({
        request,
        user: request.user,
        action: "passkey_delete",
        module: "auth",
        status: 200,
        detail: (request.params as { id: string }).id,
      });
      return { ok: true };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const user = userForRequest(request);
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (token) destroySession(token);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    logActivity({
      request,
      user,
      action: "logout",
      module: "auth",
      status: 200,
    });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    return { user: userForRequest(request) };
  });
}
