export type DingTalkAccountConfig = {
  clientId: string;
  clientSecret: string;
  enabled?: boolean;
};

export type DingTalkPluginConfig = {
  accounts?: Record<string, DingTalkAccountConfig>;
  /** Enable group chat. When false (default), @mentions in groups get a "not supported" reply. */
  groupEnabled?: boolean;
  /** Staff id of the owner. Group messages from anyone else get a constraint+identity tag. */
  ownerStaffId?: string;
};
