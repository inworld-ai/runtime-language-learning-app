import { GraphOutputStream, GraphTypes } from '@inworld/runtime/graph';
import { v4 } from 'uuid';
import { RawData } from 'ws';

const WavEncoder = require('wav-encoder');

import {
  FRAME_PER_BUFFER,
  INPUT_SAMPLE_RATE,
  MIN_SPEECH_DURATION_MS,
  PAUSE_DURATION_THRESHOLD_MS,
  SPEECH_THRESHOLD,
} from '../../constants';
import {
  AudioInput,
  ChatMessage,
  EVENT_TYPE,
  State,
  TextInput,
} from '../types';
import { InworldApp } from './app';
import { EventFactory } from './event_factory';
import { InworldGraphWrapper } from './graph';

export class MessageHandler {
  private INPUT_SAMPLE_RATE = INPUT_SAMPLE_RATE;
  private FRAME_PER_BUFFER = FRAME_PER_BUFFER;
  private PAUSE_DURATION_THRESHOLD_MS = PAUSE_DURATION_THRESHOLD_MS;
  private MIN_SPEECH_DURATION_MS = MIN_SPEECH_DURATION_MS;

  private pauseDuration = 0;
  private isCapturingSpeech = false;
  private speechBuffer: number[] = [];
  private processingQueue: (() => Promise<void>)[] = [];
  private isProcessing = false;

  private audioBuffer: any[] = [];

  constructor(
    private inworldApp: InworldApp,
    private send: (data: any) => void,
  ) {}

  async handleMessage(data: RawData, key: string) {
    const message = JSON.parse(data.toString());
    const interactionId = v4();

    switch (message.type) {
      case EVENT_TYPE.TEXT:
        let input = {
          text: message.text,
          interactionId,
          key,
        } as TextInput;

        this.addToQueue(() =>
          this.executeGraph({
            key,
            input,
            interactionId,
            graphWrapper: this.inworldApp.graphWithTextInput,
          }),
        );

        break;

      case EVENT_TYPE.AUDIO:
        for (let i = 0; i < message.audio.length; i++) {
          Object.values(message.audio[i]).forEach((value) => {
            this.audioBuffer.push(value);
          });
        }

        if (this.audioBuffer.length >= this.FRAME_PER_BUFFER) {
          const audioChunk = {
            data: this.audioBuffer,
            sampleRate: this.INPUT_SAMPLE_RATE,
          };
          this.audioBuffer = [];
          const vadResult = await this.inworldApp.vadClient.detectVoiceActivity(
            audioChunk,
            SPEECH_THRESHOLD,
          );

          if (this.isCapturingSpeech) {
            this.speechBuffer.push(...audioChunk.data);
            if (vadResult === -1) {
              // Already capturing speech but new chunk has no voice activity
              this.pauseDuration +=
                (audioChunk.data.length * 2000) / this.INPUT_SAMPLE_RATE;
              if (this.pauseDuration > this.PAUSE_DURATION_THRESHOLD_MS) {
                this.isCapturingSpeech = false;

                const speechDuration =
                  (this.speechBuffer.length * 2000) / this.INPUT_SAMPLE_RATE;
                if (speechDuration > this.MIN_SPEECH_DURATION_MS) {
                  console.log('speechDuration', speechDuration);
                  await this.processCapturedSpeech(key, interactionId);
                }
              }
            } else {
              // Already capturing speech and new chunk has voice activity
              this.pauseDuration = 0;
            }
          } else {
            if (vadResult !== -1) {
              // Not capturing speech but new chunk has voice activity. start capturing speech
              this.isCapturingSpeech = true;

              this.speechBuffer.push(...audioChunk.data);
              this.pauseDuration = 0;
            } else {
              // Not capturing speech and new chunk has no voice activity. do nothing
            }
          }
        }
        break;

      case EVENT_TYPE.AUDIO_SESSION_END:
        this.pauseDuration = 0;
        this.isCapturingSpeech = false;

        if (this.speechBuffer.length > 0) {
          await this.processCapturedSpeech(key, interactionId);
        }

        break;
    }
  }

  private normalizeAudio(audioBuffer: number[]): number[] {
    let maxVal = 0;
    // Find maximum absolute value
    for (let i = 0; i < audioBuffer.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(audioBuffer[i]));
    }

    if (maxVal === 0) {
      return audioBuffer;
    }

    // Create normalized copy
    const normalizedBuffer = [];
    for (let i = 0; i < audioBuffer.length; i++) {
      normalizedBuffer.push(audioBuffer[i] / maxVal);
    }

    return normalizedBuffer;
  }

  private async processCapturedSpeech(key: string, interactionId: string) {
    let input: AudioInput | null = null;

    try {
      input = {
        audio: {
          // Normalize to get consistent input regardless of how loud or quiet the user's microphone input is.
          // Avoid normalizing before VAD else quiet ambient sound can be amplified and trigger VAD.
          data: this.normalizeAudio(this.speechBuffer),
          sampleRate: this.INPUT_SAMPLE_RATE,
        },
        interactionId,
        key,
      } as AudioInput;

      this.speechBuffer = [];

      this.addToQueue(() =>
        this.executeGraph({
          key,
          input,
          interactionId,
          graphWrapper: this.inworldApp.graphWithAudioInput,
        }),
      );
    } catch (error) {
      console.error('Error processing captured speech:', error.message);
    }
  }

  private async executeGraph({
    key,
    input,
    interactionId,
    graphWrapper,
  }: {
    key: string;
    input: TextInput | AudioInput;
    interactionId: string;
    graphWrapper: InworldGraphWrapper;
  }) {
    const outputStream = graphWrapper.graph.start(input, v4());

    await this.handleResponse(
      outputStream,
      interactionId,
      this.inworldApp.connections[key].state,
    );

    this.send(EventFactory.interactionEnd(interactionId));

    graphWrapper.graph.closeExecution(outputStream);
  }

  private async handleResponse(
    outputStream: GraphOutputStream,
    interactionId: string,
    state: State,
  ) {
    const responseMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      id: interactionId,
    };

    try {
      const result = await outputStream.next();

      await result.processResponse({
        TTSOutputStream: async (ttsStream: GraphTypes.TTSOutputStream) => {
          for await (const chunk of ttsStream) {
            responseMessage.content += chunk.text;

            const audioBuffer = await WavEncoder.encode({
              sampleRate: chunk.audio.sampleRate,
              channelData: [new Float32Array(chunk.audio.data)],
            });

            const textPacket = EventFactory.text(chunk.text, interactionId, {
              isAgent: true,
              name: state.agent.id,
            });

            this.send(textPacket);
            this.send(
              EventFactory.audio(
                Buffer.from(audioBuffer).toString('base64'),
                interactionId,
                textPacket.packetId.utteranceId,
              ),
            );

            // Update the message content.
            const message = state.messages.find(
              (m) => m.id === interactionId && m.role === 'assistant',
            );
            if (message) {
              message.content = responseMessage.content;
            } else {
              state.messages.push(responseMessage);
            }
          }
        },
      });
    } catch (error) {
      console.error(error);
      const errorPacket = EventFactory.error(error, interactionId);
      // Ignore errors caused by empty speech.
      if (!errorPacket.error.includes('recognition produced no text')) {
        this.send(errorPacket);
      }
    }
  }

  private addToQueue(task: () => Promise<void>) {
    this.processingQueue.push(task);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    while (this.processingQueue.length > 0) {
      const task = this.processingQueue.shift();
      if (task) {
        try {
          await task();
        } catch (error) {
          console.error('Error processing task from queue:', error);
        }
      }
    }
    this.isProcessing = false;
  }
}
