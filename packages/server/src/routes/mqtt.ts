import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mqttControlPublishSchema, mqttSettingsInputSchema } from "@sm/shared";
import { requireAuth, requirePermission, requireRole } from "../auth.js";
import { saveSharedSettingsToGit } from "../git-store.js";
import { getIntegrationSettings, isMqttEnabled } from "../integrations.js";
import {
  getMqttStatus,
  isAllowedMqttApiPath,
  listMqttControls,
  publishMqttControl,
  reloadMqttBridge,
} from "../mqtt-bridge.js";
import { getMqttSettings, saveMqttSettings } from "../mqtt-settings.js";

async function requireMqtt(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isMqttEnabled()) {
    await reply.code(404).send({ error: "MQTT adapter is disabled" });
  }
}

export async function mqttRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/mqtt/settings",
    { preHandler: [requireAuth, requireRole("admin")] },
    async () => ({
      settings: getMqttSettings(),
      status: getMqttStatus(),
    }),
  );

  app.get(
    "/api/mqtt/status",
    { preHandler: [requireAuth, requireRole("admin")] },
    async () => ({ status: getMqttStatus() }),
  );

  app.put(
    "/api/mqtt/settings",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const parsed = mqttSettingsInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid MQTT settings",
          issues: parsed.error.issues,
        });
      }
      const mappings = parsed.data.mappings;
      const duplicate = mappings.find(
        (mapping, index) =>
          mapping.enabled &&
          mappings.findIndex(
            (candidate) => candidate.enabled && candidate.command === mapping.command,
          ) !== index,
      );
      if (duplicate) {
        return reply.code(400).send({
          error: `Duplicate incoming command: ${duplicate.command}`,
        });
      }
      const blocked = mappings.find(
        (mapping) => !isAllowedMqttApiPath(mapping.path),
      );
      if (blocked) {
        return reply.code(400).send({
          error: `MQTT command ${blocked.command} targets a protected API path`,
        });
      }
      const settings = saveMqttSettings(parsed.data);
      const status = reloadMqttBridge();
      if (getIntegrationSettings().mqtt === "shared") {
        await saveSharedSettingsToGit().catch((error) =>
          request.log.warn({ err: error }, "shared MQTT settings save failed"),
        );
      }
      return { settings, status };
    },
  );

  app.get(
    "/api/mqtt/controls",
    { preHandler: [requireAuth, requireMqtt] },
    async () => ({ controls: listMqttControls() }),
  );

  app.post(
    "/api/mqtt/controls/:id/publish",
    { preHandler: [requireAuth, requireMqtt, requirePermission("live")] },
    async (request, reply) => {
      const parsed = mqttControlPublishSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid MQTT control request",
          issues: parsed.error.issues,
        });
      }
      try {
        return {
          ok: true,
          ...(await publishMqttControl(
            (request.params as { id: string }).id,
            parsed.data.optionIndex,
          )),
        };
      } catch (error) {
        return reply.code(409).send({
          error: error instanceof Error ? error.message : "Could not publish MQTT control",
        });
      }
    },
  );
}
