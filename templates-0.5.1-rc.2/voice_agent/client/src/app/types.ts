export type ConfigurationSession = {
  agent?: ConfigurationAgent;
  user?: ConfigurationUser;
};

export type ConfigurationAgent = {
  name?: string;
  description?: string;
  motivation?: string;
  knowledge?: string;
};

export type ConfigurationScene = {
  name?: string;
};

export type ConfigurationUser = {
  name?: string;
};

export type Configuration = {
  agent?: ConfigurationAgent;
  scene?: ConfigurationScene;
  user?: ConfigurationUser;
};

export type Agent = {
  name?: string;
  id?: string;
};

export type Actor = {
  name: string;
  isUser: boolean;
  isAgent: boolean;
};

export enum CHAT_HISTORY_TYPE {
  ACTOR = 'actor',
  TEXT = 'text',
  INTERACTION_END = 'interaction_end',
}

export type HistoryItemBase = {
  date: Date;
  id: string;
  interactionId?: string;
  source: Actor;
  type: CHAT_HISTORY_TYPE;
};

export type HistoryItemActor = HistoryItemBase & {
  type: CHAT_HISTORY_TYPE.ACTOR;
  text: string;
  isRecognizing?: boolean;
  author?: string;
  source: Actor;
};

export type HistoryItemInteractionEnd = HistoryItemBase & {
  type: CHAT_HISTORY_TYPE.INTERACTION_END;
};

export type ChatHistoryItem = HistoryItemActor | HistoryItemInteractionEnd;
