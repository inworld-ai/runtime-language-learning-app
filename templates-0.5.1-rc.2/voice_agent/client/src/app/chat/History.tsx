import { Box, Fade, Stack, Typography } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';

import { dateWithMilliseconds } from '../helpers/transform';
import {
  Actor,
  CHAT_HISTORY_TYPE,
  ChatHistoryItem,
  HistoryItemActor,
} from '../types';
import {
  HistoryActor,
  HistoryInner,
  HistoryItemMessageActor,
  HistoryMessageGroup,
  HistoryStyled,
} from './Chat.styled';
import { Typing } from './Typing';

interface HistoryProps {
  history: ChatHistoryItem[];
}

type CombinedHistoryItem = {
  interactionId: string;
  messages: HistoryItemActor[];
  source: Actor;
  type: CHAT_HISTORY_TYPE;
};

export const History = (props: HistoryProps) => {
  const { history } = props;

  const ref = useRef<HTMLDivElement>(null);

  const [combinedChatHistory, setCombinedChatHistory] = useState<
    CombinedHistoryItem[]
  >([]);
  const [isInteractionEnd, setIsInteractionEnd] = useState<boolean>(true);

  useEffect(() => {
    // scroll chat down on history change
    if (ref.current && history) {
      ref.current.scrollTo({
        top: ref.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [history]);

  useEffect(() => {
    let currentRecord: CombinedHistoryItem | undefined;
    const mergedRecords: CombinedHistoryItem[] = [];
    const hasActors = history.find(
      (record: ChatHistoryItem) => record.type === CHAT_HISTORY_TYPE.ACTOR,
    );
    const filteredEvents = history.filter((record: ChatHistoryItem) =>
      [CHAT_HISTORY_TYPE.ACTOR, CHAT_HISTORY_TYPE.INTERACTION_END].includes(
        record.type,
      ),
    );

    for (let i = 0; i < history.length; i++) {
      let item = history[i];
      switch (item.type) {
        case CHAT_HISTORY_TYPE.ACTOR:
          currentRecord = mergedRecords.find(
            (r) =>
              r.interactionId === item.interactionId &&
              [CHAT_HISTORY_TYPE.ACTOR].includes(r.messages?.[0]?.type) &&
              r.type === CHAT_HISTORY_TYPE.ACTOR &&
              r.source.name === item.source.name,
          ) as CombinedHistoryItem;

          if (currentRecord) {
            currentRecord.messages.push(item);
          } else {
            currentRecord = {
              interactionId: item.interactionId,
              messages: [item],
              source: item.source,
              type: CHAT_HISTORY_TYPE.ACTOR,
            } as CombinedHistoryItem;
            mergedRecords.push(currentRecord);
          }
          break;
      }
    }

    // Interaction is considered ended
    // when there is no actor action yet (chat is not started)
    // or last received message is INTERACTION_END.
    const lastInteractionId =
      filteredEvents[filteredEvents.length - 1]?.interactionId;

    const interactionEnd = filteredEvents.find(
      (event) =>
        event.interactionId === lastInteractionId &&
        event.type === CHAT_HISTORY_TYPE.INTERACTION_END,
    );

    setIsInteractionEnd(!hasActors || (!!currentRecord && !!interactionEnd));

    setCombinedChatHistory(mergedRecords);
  }, [history]);

  const getContent = (message: HistoryItemActor) => {
    switch (message.type) {
      case CHAT_HISTORY_TYPE.ACTOR:
        return message.text;
    }
  };

  return (
    <HistoryStyled>
      <HistoryInner ref={ref}>
        <Box className="history--avatar-list">
          {combinedChatHistory.map((item, index) => {
            let messages = item.messages;
            let actorSource = 'AGENT';
            let message = item.messages?.[0];

            const title =
              item.type === CHAT_HISTORY_TYPE.ACTOR
                ? `${dateWithMilliseconds(message.date)} (${
                    item.interactionId
                  })`
                : '';

            if (item.type === CHAT_HISTORY_TYPE.ACTOR) {
              actorSource = item.source.isAgent ? 'AGENT' : 'USER';
            }

            return (
              <HistoryMessageGroup
                key={`PortalSimulatorChatHistoryMessageGroup-${index}`}
                className={`history-message-group history-message-group--${actorSource}`}
              >
                <HistoryActor
                  className="chat__bubble"
                  title={title}
                  key={index}
                  data-id={message.id}
                >
                  <Stack
                    sx={{ maxWidth: ['90%', '85%'] }}
                    flexDirection={'row'}
                    alignItems="center"
                  >
                    <HistoryItemMessageActor
                      className="history-actor"
                      key={`PortalSimulatorChatHistoryActor-${index}`}
                    >
                      <Typography>
                        {messages.map((m) => (
                          <React.Fragment key={m.id}>
                            {getContent(m)}
                            {''}
                          </React.Fragment>
                        ))}
                      </Typography>
                    </HistoryItemMessageActor>
                  </Stack>
                </HistoryActor>
              </HistoryMessageGroup>
            );
          })}
          <Fade in={!isInteractionEnd} timeout={500}>
            <Box margin="0 0 20px 20px">
              <Typing />
            </Box>
          </Fade>
        </Box>
      </HistoryInner>
    </HistoryStyled>
  );
};
