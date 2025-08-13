import { CopyAll, Mic, Send } from '@mui/icons-material';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import { useCallback, useState } from 'react';

import { FRAME_PER_BUFFER, INPUT_SAMPLE_RATE } from '../../../../constants';
import { CHAT_HISTORY_TYPE, ChatHistoryItem } from '../types';
import { ActionsStyled, RecordIcon } from './Chat.styled';
import { CopyConfirmedDialog } from './CopyConfirmedDialog';
import { History } from './History';

interface ChatProps {
  chatHistory: ChatHistoryItem[];
  connection: WebSocket;
  onStopChatting: () => void;
  userName: string;
}

let interval: NodeJS.Timeout;
let stream: MediaStream;
let audioCtx: AudioContext;

export function Chat(props: ChatProps) {
  const { chatHistory, connection } = props;

  const [text, setText] = useState('');
  const [copyDestination, setCopyDestination] = useState('');
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
    },
    [],
  );

  const formatTranscript = useCallback((messages: ChatHistoryItem[]) => {
    let transcript = '';

    messages.forEach((item) => {
      switch (item.type) {
        case CHAT_HISTORY_TYPE.ACTOR:
          // Add each message on a new line with proper formatting
          transcript += `\n${item.author}: ${item.text}`;
          break;
      }
    });

    return transcript.trim(); // Remove leading newline
  }, []);

  const getTranscript = useCallback(
    (messages: ChatHistoryItem[], startId?: string, endId?: string) => {
      if (!messages.length) {
        return '';
      }

      // get full array by default
      let startIndex: number = 0;
      let endIndex: number = messages.length - 1;

      if (startId || endId) {
        // find start/end indexes of the slice if ids are specified
        messages.forEach((item, index) => {
          if (item.id === startId) {
            startIndex = index;
          }

          if (item.id === endId) {
            endIndex = index;
          }
        });
      }

      if (endIndex < startIndex) {
        const tmp = startIndex;
        startIndex = endIndex;
        endIndex = tmp;
      }

      // generate eventual transcript
      return formatTranscript(messages.slice(startIndex, endIndex + 1));
    },
    [formatTranscript],
  );

  const handleCopyClick = useCallback(async () => {
    const history = getTranscript(chatHistory);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(history).then(() => {
        setCopyDestination('clipboard');
      });
    } else {
      setCopyDestination('console');
    }

    setCopyConfirmOpen(true);
  }, [getTranscript, chatHistory]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    clearInterval(interval);
    stream.getTracks().forEach((track) => track.stop());
    connection.send(JSON.stringify({ type: 'audioSessionEnd' }));
  }, [connection]);

  const startRecording = useCallback(async () => {
    try {
      setIsRecording(true);

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: { ideal: true },
        },
        video: false,
      });
      audioCtx = new AudioContext({
        sampleRate: INPUT_SAMPLE_RATE,
      });
      const source = audioCtx.createMediaStreamSource(stream);
      const scriptNode = audioCtx.createScriptProcessor(FRAME_PER_BUFFER, 1, 1);
      let leftChannel: Float32Array[] = [];

      scriptNode.onaudioprocess = (audioProcessingEvent) => {
        const samples = audioProcessingEvent.inputBuffer.getChannelData(0);
        leftChannel.push(new Float32Array(samples));
      };

      source.connect(scriptNode);
      scriptNode.connect(audioCtx.destination);

      interval = setInterval(() => {
        connection.send(
          JSON.stringify({
            type: 'audio',
            audio: leftChannel,
          }),
        );
        //clear buffer
        leftChannel = [];
      }, 100);
    } catch (e) {
      console.error(e);
    }
  }, [connection]);

  const handleSend = useCallback(() => {
    if (text) {
      connection.send(JSON.stringify({ type: 'text', text }));

      setText('');
    }
  }, [connection, text]);

  const handleTextKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSpeakClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      setIsRecording(false);
      return;
    }

    return startRecording();
  }, [isRecording, startRecording, stopRecording]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        position: 'relative',
        paddingBottom: '4.5rem',
        overflow: 'hidden',
        zIndex: 2,
      }}
    >
      <History history={chatHistory} />
      <ActionsStyled>
        <TextField
          variant="standard"
          fullWidth
          value={text}
          onChange={handleTextChange}
          onKeyPress={handleTextKeyPress}
          sx={{
            backgroundColor: (theme) => theme.palette.grey[100],
            borderRadius: '1rem',
            padding: '1rem',
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={handleSend}>
                  <Send />
                </IconButton>
              </InputAdornment>
            ),
            disableUnderline: true,
          }}
        />
        <IconButton
          onClick={handleSpeakClick}
          sx={{ height: '3rem', width: '3rem', backgroundColor: '#F1F5F9' }}
        >
          {isRecording ? <RecordIcon /> : <Mic />}
        </IconButton>
        <IconButton onClick={handleCopyClick}>
          <CopyAll fontSize="small" />
        </IconButton>
      </ActionsStyled>
      <CopyConfirmedDialog
        copyConfirmOpen={copyConfirmOpen}
        copyDestination={copyDestination}
        setCopyConfirmOpen={setCopyConfirmOpen}
      />
    </Box>
  );
}
