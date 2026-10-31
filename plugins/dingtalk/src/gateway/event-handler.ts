import { pluginMessage, resolvePluginText } from "@marswave/cola-plugin-sdk";
import type { PluginRuntime, DeliverFn, PluginLogger } from "@marswave/cola-plugin-sdk";
import { buildTextMessage, enforceMsgParamLimit } from "../api/client.js";
import type { DingTalkClient } from "../api/client.js";
import { parseRobotMessage } from "./message.js";
import type { ParsedRobotMessage } from "./message.js";
import { MessageDedup } from "./dedup.js";
import { downloadRobotMessageMedia } from "./media-download.js";

/** Reply sent to a group @mention while group chat is disabled. */
export const GROUP_DISABLED_NOTICE = pluginMessage(
  "channel.groupDisabled",
  "Group chat is not enabled. Send a direct message to the bot instead.",
);

/** Constraint+identity tag prepended to non-owner group messages. */
export const NON_OWNER_TAG_PREFIX = "[非所有者消息 · ";
export const OWNER_TAG_PREFIX = "[所有者]";

/**
 * Appended to the delivered text when the message's media download succeeded.
 * Bilingual so the assertion is stable regardless of the agent's language.
 */
export const MEDIA_DOWNLOADED_NOTE =
  "[System note: the attached image/file was successfully downloaded from this message and is available to you. / 系统提示：本消息的图片/文件已成功下载并附给你。]";

/**
 * Appended to the delivered text when the message contained media but the
 * download failed — the agent must never guess or recall what the image/file
 * showed (a real incident where the agent fabricated content from memory).
 * Bilingual and directive so the model has no room to fabricate.
 */
export const MEDIA_DOWNLOAD_FAILED_WARN =
  "[System note: this message contained an image/file but the download FAILED — you have NOT received any media content. Do NOT guess or fabricate what it shows; tell the user honestly that you cannot view it and ask them to retry. / 系统提示：本消息包含图片/文件，但下载失败，你并未收到任何媒体内容。请勿猜测或编造内容，应如实告知用户无法查看并请其重试。]";

export type EventHandlerDeps = {
  i18n?: PluginRuntime["i18n"];
  accountId: string;
  client: DingTalkClient;
  logger: PluginLogger;
  deliver: DeliverFn;
  /** Second dedup layer on top of the Stream ack (server retries after 60s). */
  dedup: MessageDedup;
  /** When false, group @mentions get a "not supported" reply instead of reaching the agent. */
  groupEnabled: boolean;
  /** When set, group @mentions from this staff id are tagged as the owner; others get a constraint+identity tag. */
  ownerStaffId?: string;
  /** Observes the robotCode from inbound payloads for outbound replies. */
  onRobotCode?: (robotCode: string) => void;
};

/** Bilingual constraint line for non-owner group messages. */
function buildNonOwnerTag(parsed: ParsedRobotMessage): string {
  const nick = parsed.senderNick ?? "unknown";
  const id = parsed.senderId ?? "unknown";
  return (
    `${NON_OWNER_TAG_PREFIX}发送者: ${nick}(${id}) · ` +
    `约束：仅回复与本群相关的总结性内容，禁止提供文件、资料或任何私人信息；` +
    `Constraint: only reply with summaries relevant to this group; never provide files, materials, or any private information]`
  );
}

/** Tag a group message's text before it reaches the agent. Direct chats are left untouched. */
export function annotateGroupMessage(parsed: ParsedRobotMessage, ownerStaffId?: string): string {
  if (!parsed.isGroup) return parsed.text;
  // Group payloads carry senderId as a LWCP union id, which never matches the
  // configured staffId ownerStaffId — the owner must be matched via
  // senderStaffId (present for published robots), falling back to senderId.
  const resolvedSenderId = parsed.senderStaffId ?? parsed.senderId;
  if (ownerStaffId && resolvedSenderId === ownerStaffId) {
    return `${OWNER_TAG_PREFIX}\n${parsed.text}`;
  }
  return `${buildNonOwnerTag(parsed)}\n${parsed.text}`;
}

/**
 * Handle one robot message payload (JSON string) from the Stream channel.
 *
 * Authorization is delegated to the host's SDK access gate: this handler only
 * delivers, populating `conversation` (direct vs group) and `mentionedBot` so
 * the gate can authorize per-sender (DM) or per-group (@bot-gated).
 */
export async function handleRobotMessage(
  deps: EventHandlerDeps,
  rawPayload: string,
): Promise<void> {
  const { accountId, logger, deliver, dedup } = deps;

  const parsed = parseRobotMessage(rawPayload, logger);
  if (!parsed) return;

  if (parsed.robotCode) deps.onRobotCode?.(parsed.robotCode);

  // Second dedup layer: the Stream ack prevents most server retries, but a
  // redelivered msgId must never reach the agent twice.
  if (dedup.isDuplicate(parsed.msgId)) return;

  if (parsed.isGroup && !deps.groupEnabled) {
    await sendGroupDisabledNotice(deps, parsed);
    return;
  }

  const text = parsed.text.trim();
  if (!text) return;

  // Group messages: prepend a sender tag (+ owner-vs-non-owner constraint) so
  // the agent knows who posted. Direct chats are left untouched.
  let messageToDeliver = parsed.isGroup ? annotateGroupMessage(parsed, deps.ownerStaffId) : text;

  // Direct-chat replies require senderStaffId, which DingTalk only pushes for
  // published robot versions. Without it there is no way to answer.
  if (!parsed.isGroup && !parsed.senderStaffId) {
    logger.warn(
      `dingtalk[${accountId}]: direct message without senderStaffId (robot version not published?), cannot reply`,
    );
    return;
  }

  const senderId = parsed.senderStaffId ?? parsed.senderId;
  if (!senderId) {
    logger.warn("DingTalk message missing sender id, skipping");
    return;
  }

  // Media messages (including rich-text messages that embed pictures) carry a
  // downloadCode; exchange it for a temp URL, download to a local path, and
  // hand the path to the agent as an attachment. When the download succeeds
  // the text is still the short summary (the file itself is the payload);
  // failures keep the summary only.
  //
  // The delivered text must explicitly state the media outcome. Failing to
  // announce a download failure lets the agent guess/fabricate what an image
  // showed (a documented incident), so a success note or a failure warning is
  // appended whenever the message carried media.
  let attachment: string | undefined;
  let mediaNote: string | null = null;
  if (parsed.media?.downloadCode) {
    if (!parsed.robotCode) {
      logger.warn(`dingtalk[${accountId}]: media message without robotCode, cannot download`);
      mediaNote = MEDIA_DOWNLOAD_FAILED_WARN;
    } else {
      attachment = await downloadRobotMessageMedia(deps.client, parsed, logger);
      if (attachment) {
        mediaNote = MEDIA_DOWNLOADED_NOTE;
      } else {
        logger.warn(
          `dingtalk[${accountId}]: media message download failed — agent will be told it has no media content`,
        );
        mediaNote = MEDIA_DOWNLOAD_FAILED_WARN;
      }
    }
  }

  messageToDeliver = mediaNote
    ? `${messageToDeliver ? `${messageToDeliver}\n` : ""}${mediaNote}`.trim()
    : messageToDeliver;

  await deliver({
    sessionId: parsed.isGroup
      ? ["conversation", accountId, parsed.conversationId]
      : ["staff", accountId, parsed.senderStaffId!],
    sender: { id: senderId, name: parsed.senderNick },
    conversation: parsed.isGroup
      ? { kind: "group", id: parsed.conversationId }
      : { kind: "direct", id: parsed.senderStaffId! },
    mentionedBot: parsed.isGroup ? true : undefined,
    deliveryContext: {
      to: buildDeliveryTarget(parsed),
      accountId,
      messageId: parsed.msgId,
    },
    message: messageToDeliver,
    ...(attachment ? { attachments: [attachment] } : {}),
  });
}

function buildDeliveryTarget(parsed: ParsedRobotMessage): string {
  return parsed.isGroup ? `conversation:${parsed.conversationId}` : `staff:${parsed.senderStaffId}`;
}

async function sendGroupDisabledNotice(
  deps: EventHandlerDeps,
  parsed: ParsedRobotMessage,
): Promise<void> {
  const { accountId, logger, client } = deps;
  if (!parsed.robotCode) {
    logger.warn(`dingtalk[${accountId}]: cannot send group-disabled notice, robotCode missing`);
    return;
  }
  const notice = deps.i18n
    ? await deps.i18n.text(GROUP_DISABLED_NOTICE)
    : resolvePluginText(GROUP_DISABLED_NOTICE, undefined, "en");
  try {
    await client.sendGroupMessage(
      parsed.robotCode,
      parsed.conversationId,
      enforceMsgParamLimit(buildTextMessage(notice)),
    );
  } catch (err) {
    logger.warn(
      `dingtalk[${accountId}]: failed to send group-disabled notice to ${parsed.conversationId}`,
      err,
    );
  }
}
