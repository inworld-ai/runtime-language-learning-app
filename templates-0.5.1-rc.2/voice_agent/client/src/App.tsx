import './App.css';

import { ArrowBackRounded } from '@mui/icons-material';
import { Button } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import toast, { Toaster } from 'react-hot-toast';
import { v4 } from 'uuid';

import { Chat } from './app/chat/Chat';
import { Layout } from './app/components/Layout';
import {
  ChatWrapper,
  MainWrapper,
  SimulatorHeader,
} from './app/components/Simulator';
import { ConfigView } from './app/configuration/ConfigView';
import {
  get as getConfiguration,
  save as saveConfiguration,
} from './app/helpers/configuration';
import { Player } from './app/sound/Player';
import {
  Agent,
  CHAT_HISTORY_TYPE,
  ChatHistoryItem,
  Configuration,
} from './app/types';
import { config } from './config';
import * as defaults from './defaults';

interface CurrentContext {
  agent?: Agent;
  chatting: boolean;
  connection?: WebSocket;
  userName?: string;
}

const sound = new Audio();
const player = new Player();
let key = '';

function App() {
  const formMethods = useForm<Configuration>();

  const [open, setOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [connection, setConnection] = useState<WebSocket>();
  const [agent, setAgent] = useState<Agent>();
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [chatting, setChatting] = useState(false);
  const [userName, setUserName] = useState('');

  const stateRef = useRef<CurrentContext>();
  stateRef.current = {
    agent,
    chatting,
    connection,
    userName,
  };

  const onOpen = useCallback(() => {
    console.log('Open!');
    setOpen(true);
  }, []);

  const onDisconnect = useCallback(() => {
    console.log('Disconnect!');
    setOpen(true);
  }, []);

  const onMessage = useCallback((message: MessageEvent) => {
    const packet = JSON.parse(message.data);

    let chatItem: ChatHistoryItem | undefined = undefined;

    if (packet?.type === 'AUDIO') {
      player.addToQueue({ audio: packet.audio });
    } else if (packet?.type === 'TEXT') {
      const { agent, userName } = stateRef.current || {};

      chatItem = {
        id: packet.packetId?.utteranceId,
        type: CHAT_HISTORY_TYPE.ACTOR,
        date: new Date(packet.date!),
        source: packet.routing?.source,
        text: packet.text.text,
        interactionId: packet.packetId?.interactionId,
        isRecognizing: !packet.text.final,
        author: packet.routing!.source!.isAgent ? agent?.name : userName,
      };
    } else if (packet?.type === 'INTERACTION_END') {
      chatItem = {
        id: v4(),
        type: CHAT_HISTORY_TYPE.INTERACTION_END,
        date: new Date(packet.date!),
        source: packet.routing?.source,
        interactionId: packet.packetId?.interactionId,
      };
    } else if (packet?.type === 'ERROR') {
      toast.error(packet?.error ?? 'Something went wrong');
    }

    if (chatItem) {
      setChatHistory((currentState) => {
        let newState = undefined;
        let currentHistoryIndex = currentState.findIndex((item) => {
          return item.id === chatItem?.id;
        });

        if (currentHistoryIndex >= 0 && chatItem) {
          newState = [...currentState];
          newState[currentHistoryIndex] = chatItem;
        } else {
          newState = [...currentState, chatItem!];
        }
        return newState;
      });
    }
  }, []);

  const openConnection = useCallback(async () => {
    key = v4();
    const { agent, user } = formMethods.getValues();

    setChatting(true);
    setUserName(user?.name!);

    const response = await fetch(`${config.LOAD_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: user?.name,
        agent,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      return console.log(response.statusText, ': ', data.errors);
    }

    if (data.agent) {
      setAgent(data.agent as Agent);
    }

    const ws = new WebSocket(`${config.SESSION_URL}?key=${key}`);

    setConnection(ws);

    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('disconnect', onDisconnect);
  }, [formMethods, onDisconnect, onMessage, onOpen]);

  const stopChatting = useCallback(async () => {
    // Disable flags
    setChatting(false);
    setOpen(false);

    // Stop audio playing
    player.stop();

    // Clear collections
    setChatHistory([]);

    // Close connection and clear connection data
    connection?.close();
    connection?.removeEventListener('open', onOpen);
    connection?.removeEventListener('message', onMessage);
    connection?.removeEventListener('disconnect', onDisconnect);

    setConnection(undefined);
    setAgent(undefined);

    await fetch(`${config.UNLOAD_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    key = '';
  }, [connection, onDisconnect, onMessage, onOpen]);

  const resetForm = useCallback(() => {
    formMethods.reset({
      ...defaults.configuration,
    });
    saveConfiguration(formMethods.getValues());
  }, [formMethods]);

  useEffect(() => {
    const configuration = getConfiguration();
    const parsedConfiguration = configuration
      ? JSON.parse(configuration)
      : defaults.configuration;

    formMethods.reset({
      ...parsedConfiguration,
    });

    setInitialized(true);
  }, [formMethods]);

  useEffect(() => {
    player.preparePlayer({ audio: sound });
  }, []);

  const content = chatting ? (
    <>
      {open && agent ? (
        <MainWrapper>
          <Toaster
            toastOptions={{
              style: {
                maxWidth: 'fit-content',
                wordBreak: 'break-word',
              },
            }}
          />
          <ChatWrapper>
            <SimulatorHeader>
              <Button
                startIcon={<ArrowBackRounded />}
                onClick={stopChatting}
                variant="outlined"
              >
                Back to settings
              </Button>
            </SimulatorHeader>
            <Chat
              chatHistory={chatHistory}
              connection={connection!}
              onStopChatting={stopChatting}
              userName={userName}
            />
          </ChatWrapper>
        </MainWrapper>
      ) : (
        'Loading...'
      )}
    </>
  ) : (
    <ConfigView
      canStart={formMethods.formState.isValid}
      onStart={() => openConnection()}
      onResetForm={resetForm}
    />
  );

  return (
    <FormProvider {...formMethods}>
      <Layout>{initialized ? content : ''}</Layout>
    </FormProvider>
  );
}

export default App;
