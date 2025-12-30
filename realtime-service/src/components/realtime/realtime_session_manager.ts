import { v4 as uuidv4 } from 'uuid';
import logger from '../../logger';
import { formatSession, formatContext } from '../../log-helpers';
import * as RT from '../../types/realtime';
import { InworldApp } from '../app';
import { RealtimeEventFactory } from './realtime_event_factory';
import { Connection } from '../../types/index';
import { getAssemblyAISettingsForEagerness } from '../../types/settings';
import { RealtimeAudioHandler } from '../audio/realtime_audio_handler';

export class RealtimeSessionManager {
  realtimeSession: RT.RealtimeSession;
  private sessionStartTime: number;

  constructor(
    private inworldApp: InworldApp,
    private sessionKey: string,
    private send: (data: RT.ServerEvent) => void,
    sessionStartTime: number
  ) {
    this.sessionStartTime = sessionStartTime;
    this.realtimeSession = this.createDefaultSession();
  }

  getSession(): RT.RealtimeSession {
    return this.realtimeSession;
  }


  /**
   * Create a default session configuration
   */
  private createDefaultSession(): RT.RealtimeSession {
    const sessionId = uuidv4();

    const connection = this.inworldApp.connections[this.sessionKey];
    const instructions = connection?.state?.agent
      ? `You are: "${connection.state.agent.name}". Your persona is: "${connection.state.agent.description}". Your motivation is: "${connection.state.agent.motivation}".`
      : 'You are a helpful AI assistant.';

    // Session expires in 15 minutes (900 seconds)
    const expiresAt = Math.floor(Date.now() / 1000) + 900;

    const defaultOutputModalities: ('text' | 'audio')[] = ['audio', 'text'];
    
    // Sync default to connection state
    if (connection) {
      connection.state.output_modalities = defaultOutputModalities;
    }
    
    return {
      id: sessionId,
      session: {
        type: 'realtime',
        id: sessionId,
        object: 'realtime.session',
        model: this.inworldApp.llmModelName,
        output_modalities: defaultOutputModalities,
        instructions,
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
            transcription: null,
            noise_reduction: null,
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'medium',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
            voice: this.inworldApp.voiceId,
            speed: 1,
          },
        },
        tools: [],
        tool_choice: 'auto',
        temperature: 0.8,
        max_output_tokens: 'inf',
        truncation: 'auto',
        prompt: null,
        tracing: null,
        expires_at: expiresAt,
        include: null,
      },
      conversationItems: [],
      inputAudioBuffer: [],
      currentResponse: null,
      audioStartMs: 0,
      currentContentStream: null,
      currentTTSStream: null,
    };
  }

  /**
   * Handle session.update event
   */
  async updateSession(event: RT.SessionUpdateEvent): Promise<void> {
    const sessionConfig = event.session;

    // Deep merge session configuration
    if (sessionConfig.output_modalities !== undefined) {
      this.realtimeSession.session.output_modalities = sessionConfig.output_modalities;
      
      // Sync to connection state for easy access by sessionId
      const connection = this.inworldApp.connections[this.sessionKey];
      if (connection) {
        connection.state.output_modalities = sessionConfig.output_modalities;
        logger.info({
          sessionId: this.sessionKey,
          output_modalities: sessionConfig.output_modalities,
          state_modalities: connection.state.output_modalities
        }, `Updated connection.state.output_modalities`);
      } else {
        logger.warn({ sessionId: this.sessionKey }, `No connection found when updating output_modalities`);
      }
    }

    if (sessionConfig.instructions !== undefined) {
      this.realtimeSession.session.instructions = sessionConfig.instructions;

      // Inject system instructions as the first message in the conversation state
      const connection = this.inworldApp.connections[this.sessionKey];
      if (connection && sessionConfig.instructions) {
        // Check if there's already a system message at the start
        const hasSystemMessage =
          connection.state.messages.length > 0 &&
          connection.state.messages[0].role === 'system';

        if (hasSystemMessage) {
          // Update existing system message
          connection.state.messages[0].content = sessionConfig.instructions;
          logger.info({ sessionId: this.sessionKey }, 'Updated system instructions');
        } else {
          // Insert new system message at the beginning
          connection.state.messages.unshift({
            id: 'system_instructions',
            role: 'system',
            content: sessionConfig.instructions,
          });
          logger.info({ sessionId: this.sessionKey }, 'Injected system instructions');
        }
      }
    }

    if (sessionConfig.audio) {
      // Merge audio input configuration
      if (sessionConfig.audio.input) {
        if (sessionConfig.audio.input.format) {
          this.realtimeSession.session.audio.input.format = {
            ...this.realtimeSession.session.audio.input.format,
            ...sessionConfig.audio.input.format,
          };
        }
        if (sessionConfig.audio.input.transcription !== undefined) {
          this.realtimeSession.session.audio.input.transcription = sessionConfig.audio.input.transcription;
        }
        if (sessionConfig.audio.input.noise_reduction !== undefined) {
          this.realtimeSession.session.audio.input.noise_reduction = sessionConfig.audio.input.noise_reduction;
        }
        if (sessionConfig.audio.input.turn_detection !== undefined) {
          if (sessionConfig.audio.input.turn_detection === null) {
            this.realtimeSession.session.audio.input.turn_detection = null;
          } else {
            this.realtimeSession.session.audio.input.turn_detection = {
              ...this.realtimeSession.session.audio.input.turn_detection,
              ...sessionConfig.audio.input.turn_detection,
            };
            
            // Handle semantic_vad eagerness settings
            if (sessionConfig.audio.input.turn_detection.type === 'semantic_vad') {
              const eagerness = sessionConfig.audio.input.turn_detection.eagerness;
              if (eagerness && eagerness !== 'auto') {
                const connection = this.inworldApp.connections[this.sessionKey];
                if (connection) {
                  const normalizedEagerness = eagerness as 'low' | 'medium' | 'high';
                  connection.state.eagerness = normalizedEagerness;
                  logger.info({ sessionId: this.sessionKey, eagerness }, `Updated eagerness to ${eagerness}`);

                  // Dynamically update AssemblyAI turn detection settings on the active graph
                  const assemblyAINode = this.inworldApp.graphWithAudioInput?.assemblyAINode;
                  if (assemblyAINode) {
                    const assemblySettings = getAssemblyAISettingsForEagerness(normalizedEagerness);
                    // Extract only the numeric settings for updateTurnDetectionSettings
                    const { endOfTurnConfidenceThreshold, minEndOfTurnSilenceWhenConfident, maxTurnSilence } = assemblySettings;
                    logger.info({ sessionId: this.sessionKey, endOfTurnConfidenceThreshold, minEndOfTurnSilenceWhenConfident, maxTurnSilence }, `Applying eagerness settings: threshold=${endOfTurnConfidenceThreshold}`);
                    assemblyAINode.updateTurnDetectionSettings(
                        this.sessionKey,
                        { endOfTurnConfidenceThreshold, minEndOfTurnSilenceWhenConfident, maxTurnSilence }
                    )
                  } else {
                    logger.warn({ sessionId: this.sessionKey }, 'AssemblyAI node not found, settings will apply on next audio input');
                    this.send(
                        RealtimeEventFactory.error({
                          type: 'invalid_request_error',
                          code: 'no_STT_session',
                          message: `Server did not find active STT connection. Turning on Mic to start audio stream input session.`,
                          event_id: event.event_id,
                        }),
                    );
                  }
                }
              }
            }
          }
        }
      }

      // Merge audio output configuration
      if (sessionConfig.audio.output) {
        if (sessionConfig.audio.output.format) {
          this.realtimeSession.session.audio.output.format = {
            ...this.realtimeSession.session.audio.output.format,
            ...sessionConfig.audio.output.format,
          };
        }
        if (sessionConfig.audio.output.voice !== undefined) {
          this.realtimeSession.session.audio.output.voice = sessionConfig.audio.output.voice;

          // Store voice in connection state for TTS node
          const connection = this.inworldApp.connections[this.sessionKey];
          if (connection) {
            connection.state.voiceId = sessionConfig.audio.output.voice;
            logger.info({ sessionId: this.sessionKey, voice: sessionConfig.audio.output.voice }, `Updated TTS voice to ${sessionConfig.audio.output.voice}`);
          }
        }
        if (sessionConfig.audio.output.speed !== undefined) {
          this.realtimeSession.session.audio.output.speed = sessionConfig.audio.output.speed;
        }
      }
    }

    if (sessionConfig.tools !== undefined) {
      this.realtimeSession.session.tools = sessionConfig.tools;

      // Update connection state with tools
      const connection = this.inworldApp.connections[this.sessionKey];
      if (connection) {
        connection.state.tools = sessionConfig.tools;
      }
    }

    if (sessionConfig.tool_choice !== undefined) {
      this.realtimeSession.session.tool_choice = sessionConfig.tool_choice;

      // Update connection state with toolChoice
      const connection = this.inworldApp.connections[this.sessionKey];
      if (connection) {
        connection.state.toolChoice = sessionConfig.tool_choice;
      }
    }

    if (sessionConfig.temperature !== undefined) {
      this.realtimeSession.session.temperature = sessionConfig.temperature;
    }

    if (sessionConfig.max_output_tokens !== undefined) {
      this.realtimeSession.session.max_output_tokens = sessionConfig.max_output_tokens;
    }

    if (sessionConfig.truncation !== undefined) {
      this.realtimeSession.session.truncation = sessionConfig.truncation;
    }

    if (sessionConfig.prompt !== undefined) {
      this.realtimeSession.session.prompt = sessionConfig.prompt;
    }

    if (sessionConfig.tracing !== undefined) {
      this.realtimeSession.session.tracing = sessionConfig.tracing;
    }

    if (sessionConfig.include !== undefined) {
      this.realtimeSession.session.include = sessionConfig.include;
    }

    // Send session.updated event
    this.send(RealtimeEventFactory.sessionUpdated(this.realtimeSession.session));
  }

  /**
   * Handle conversation.item.create event
   */
  async createConversationItem(
    event: RT.ConversationItemCreateEvent,
    audioHandler?: RealtimeAudioHandler,
  ): Promise<void> {
    const item = {
      ...event.item,
      id: event.item.id || uuidv4(),
      object: 'realtime.item' as const,
      status: event.item.status || ('completed' as const),
    };

    this.realtimeSession.conversationItems.push(item);
    this.send(
      RealtimeEventFactory.conversationItemAdded(item, event.previous_item_id),
    );
    this.send(
      RealtimeEventFactory.conversationItemDone(item, event.previous_item_id),
    );
    
    // Add to conversation state so LLM is aware of this item
    const connection = this.inworldApp.connections[this.sessionKey];
    if (connection) {
      // Handle different item types
      if (item.type === 'function_call_output') {
        // Function call output received
        const functionOutputItem = item as RT.FunctionCallOutputItem;
        logger.info({
          sessionId: this.sessionKey,
          call_id: functionOutputItem.call_id,
          output: functionOutputItem.output,
        }, 'Function output received');
        
        // Add a system message to inform the LLM that the function was executed
        // The Inworld SDK/Groq combo doesn't properly support 'tool' role with tool_call_id
        // So we use a system message to provide context about the function execution
        connection.state.messages.push({
          role: 'system',
          content: `[SYSTEM] Function executed. Result: ${functionOutputItem.output}`,
          id: item.id,
        });
        
        logger.info({ sessionId: this.sessionKey }, 'Added function execution result to conversation');
      } else if (item.type === 'message') {
        // Handle message items
        const messageItem = item as RT.MessageItem;
        if (messageItem.content && messageItem.content.length > 0) {
          const content = messageItem.content[0];
          let textContent = '';
          
          if (content.type === 'input_text') {
            textContent = content.text || '';
          } else if (content.type === 'text') {
            textContent = content.text || '';
          } else if (content.type === 'input_audio') {
            // Audio inputs should already be handled by STT
            return;
          }
          
          if (textContent) {
            logger.info({
              sessionId: this.sessionKey,
              role: messageItem.role,
              contentPreview: textContent.substring(0, 100),
            }, `Adding ${messageItem.role} message: ${textContent.substring(0, 50)}...`);
            // We don't need to call connection.state.messages.push here. That's handled in the graph's input node
          }

          // If it's a text input, push it to the audio graph
          if (content.type === 'input_text' && content.text && audioHandler) {
            await audioHandler.handleTextInput(content.text);
          }
        }
      }
    }
  }

  /**
   * Handle conversation.item.truncate event
   */
  async truncateConversationItem(
    event: RT.ConversationItemTruncateEvent,
  ): Promise<void> {
    // Find the item
    const item = this.realtimeSession.conversationItems.find(
      (i) => i.id === event.item_id,
    );

    if (!item) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          code: 'item_not_found',
          message: `Item with id ${event.item_id} not found`,
          event_id: event.event_id,
        }),
      );
      return;
    }

    // Only assistant message items can be truncated
    if (item.role !== 'assistant') {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          code: 'invalid_item_type',
          message: 'Only assistant message items can be truncated',
          event_id: event.event_id,
        }),
      );
      return;
    }

    // Truncate the content part at the specified index
    if (item.content && item.content[event.content_index]) {
      const contentPart = item.content[event.content_index];
      
      // If it's an audio content part, truncate the audio and remove transcript
      if (contentPart.type === 'audio' && contentPart.audio) {
        // Note: In a real implementation, we would need to:
        // 1. Decode the base64 audio
        // 2. Calculate the number of samples to keep based on audio_end_ms
        // 3. Truncate the audio data
        // 4. Re-encode to base64
        // For now, we'll just remove the transcript to ensure no text is in context that hasn't been heard
        delete contentPart.transcript;
        
        // In a full implementation, we would also truncate the audio data itself
        logger.info({
          sessionId: this.sessionKey,
          itemId: event.item_id,
          audioEndMs: event.audio_end_ms,
          contentIndex: event.content_index,
        }, `Truncating item ${event.item_id} at ${event.audio_end_ms}ms`);
      }
    }

    // Send the truncated event
    this.send(
      RealtimeEventFactory.conversationItemTruncated(
        event.item_id,
        event.content_index,
        event.audio_end_ms,
      ),
    );
  }

  /**
   * Handle conversation.item.delete event
   */
  async deleteConversationItem(
    event: RT.ConversationItemDeleteEvent,
  ): Promise<void> {
    const index = this.realtimeSession.conversationItems.findIndex(
      (i) => i.id === event.item_id,
    );

    if (index === -1) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          code: 'item_not_found',
          message: `Item with id ${event.item_id} not found`,
          event_id: event.event_id,
        }),
      );
      return;
    }

    // Remove the item from conversation history
    this.realtimeSession.conversationItems.splice(index, 1);

    // Also remove from connection.state.messages so the graph doesn't see it
    const connection = this.inworldApp.connections[this.sessionKey];
    if (connection?.state?.messages) {
      const messageIndex = connection.state.messages.findIndex(
        (m) => m.id === event.item_id,
      );
      if (messageIndex !== -1) {
        connection.state.messages.splice(messageIndex, 1);
      }
    }

    // Send the deleted event
    this.send(
      RealtimeEventFactory.conversationItemDeleted(event.item_id),
    );
  }

  /**
   * Handle conversation.item.retrieve event
   */
  async retrieveConversationItem(
    event: RT.ConversationItemRetrieveEvent,
  ): Promise<void> {
    const item = this.realtimeSession.conversationItems.find(
      (i) => i.id === event.item_id,
    );

    if (!item) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          code: 'item_not_found',
          message: `Item with id ${event.item_id} not found`,
          event_id: event.event_id,
        }),
      );
      return;
    }

    // Send the retrieved item
    this.send(
      RealtimeEventFactory.conversationItemRetrieved(item),
    );
  }
}

