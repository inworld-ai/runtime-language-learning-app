import { v4 } from 'uuid';

export class EventFactory {
  static text(
    text: string,
    interactionId: string,
    source: { isAgent?: boolean; isUser?: boolean; name?: string },
  ) {
    const date = new Date();

    return {
      type: 'TEXT',
      text: { text, final: true },
      date,
      packetId: { utteranceId: v4(), interactionId },
      routing: { source },
    };
  }

  static error(error: Error, interactionId: string) {
    const date = new Date();

    return {
      type: 'ERROR',
      error: error.toString(),
      date,
      packetId: { interactionId },
    };
  }

  static interactionEnd(interactionId: string) {
    return {
      type: 'INTERACTION_END',
      date: new Date(),
      packetId: { interactionId },
    };
  }

  static audio(audio: string, interactionId: string, utteranceId: string) {
    return {
      type: 'AUDIO',
      audio: { chunk: audio },
      date: new Date(),
      packetId: { utteranceId, interactionId },
      routing: { source: { isAgent: true } },
    };
  }
}
