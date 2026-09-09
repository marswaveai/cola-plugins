/**
 * Minimal shapes for the slices of the Slack API payloads this plugin reads.
 * Socket Mode delivers loosely-typed event objects and `@slack/web-api`
 * returns very wide response types, so we narrow to just the fields used here.
 */

/** A file attached to a Slack message (events API + files.info). */
export type SlackFile = {
  id: string;
  name?: string;
  title?: string;
  size?: number;
  mimetype?: string;
  filetype?: string;
  url_private?: string;
  url_private_download?: string;
};

/** A `message`/`app_mention` event delivered over Socket Mode. */
export type SlackMessageEvent = {
  channel: string;
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
  /** "im" (DM), "mpim" (multi-person DM), "group" (private), "channel" (public). */
  channel_type?: string;
  files?: SlackFile[];
};

/** The slice of `users.info` we use to populate the channel sender. */
export type SlackUserProfile = {
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_72?: string;
  };
};
